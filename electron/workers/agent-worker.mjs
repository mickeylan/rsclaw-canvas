import { randomUUID } from 'node:crypto'
import { AIMessage } from '@langchain/core/messages'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { tool } from '@langchain/core/tools'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import { Command, interrupt, isGraphInterrupt } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { createDeepAgent, registerHarnessProfile, StateBackend } from 'deepagents/node'
import { z } from 'zod'
import { approvalRecordItems } from '../approval-record.mjs'
import { detectAgentRoute } from '../agent-routing.mjs'
import {
  buildNativeSkillBundle,
  createSingleSkillActivationMiddleware,
  explicitlyDeniedSkillIds,
  nativeSkillBundleSnapshot,
  parseSkillSemanticDecision
} from '../deep-agent-skills.mjs'
import {
  buildRoleCanvasOperations,
  compactCreativeContext,
  draftPlanFromCreativeSpec,
  expectedCreativeItemCount,
  formatCreativeSpecText,
  inferRequestedRatio,
  normalizeCreativeContext,
  parseCreativeSpec,
  reflowCreateNodeOperations,
  resolveRevisionTargetId
} from '../creative-workflow.mjs'
import { ParentRpc } from '../rpc.mjs'

const { parentPort } = process
if (!parentPort) throw new Error('Agent worker must run as an Electron utility process')

const controllers = new Map()
const runControllers = new Map()
const sequences = new Map()
const MAX_MODEL_CALLS = 12
const AGENT_TIMEOUT_MS = 3 * 60 * 1000

registerHarnessProfile('rsclaw:canvas', {
  generalPurposeSubagent: { enabled: false }
})

registerHarnessProfile('rsclaw:skill', {
  generalPurposeSubagent: { enabled: false },
  excludedTools: ['ls', 'write_file', 'edit_file', 'glob', 'grep', 'execute', 'task', 'write_todos']
})

const rpc = new ParentRpc(parentPort, {
  send: runAgent,
  resume: resumeAgent,
  cancel: cancelAgent,
  ping: () => ({ ok: true })
})

rpc.emit({ type: 'agent.ready' })

class AgentTelemetry extends BaseCallbackHandler {
  name = 'rsclaw-agent-telemetry'

  constructor(context) {
    super()
    this.context = context
  }

  handleChatModelStart() {
    this.context.metrics.stepCount += 1
    emit(this.context, 'model.started', { step: this.context.metrics.stepCount })
  }

  handleLLMEnd(output) {
    const messages = (output?.generations || []).flat()
    for (const generation of messages) {
      const usage = generation.message?.usage_metadata
      this.context.metrics.inputTokens += usage?.input_tokens || 0
      this.context.metrics.outputTokens += usage?.output_tokens || 0
    }
    emit(this.context, 'model.completed', { ...this.context.metrics })
  }

  handleToolStart(toolDefinition) {
    const name = toolDefinition?.name || 'unknown'
    if (name === 'task') emit(this.context, 'subagent.started', {})
  }
}

class RsclawChatModel extends BaseChatModel {
  constructor({
    providerId,
    modelId,
    tools = [],
    context,
    streamToUser = false,
    agentRole = 'orchestrator'
  }) {
    super({})
    this.providerId = providerId
    this.modelId = modelId
    // Deep Agents uses modelName as the harness-profile lookup key for custom models.
    this.modelName = agentRole === 'skill-router' ? 'rsclaw:skill' : 'rsclaw:canvas'
    this.boundTools = tools
    this.context = context
    this.streamToUser = streamToUser
    this.agentRole = agentRole
  }

  _llmType() {
    return this.modelName
  }

  bindTools(tools) {
    return new RsclawChatModel({
      providerId: this.providerId,
      modelId: this.modelId,
      tools,
      context: this.context,
      streamToUser: this.streamToUser,
      agentRole: this.agentRole
    })
  }

  async _generate(messages, options) {
    const cachedAgentResult = this.context.agentResultCache?.get(this.agentRole)
    if (isDomainAgentRole(this.agentRole) && cachedAgentResult) {
      return reuseAgentGeneration(this.context, this.agentRole, cachedAgentResult)
    }
    this.context.agentResultLocks ??= new Map()
    const activeAgentCall = this.context.agentResultLocks.get(this.agentRole)
    if (isDomainAgentRole(this.agentRole) && activeAgentCall) {
      await activeAgentCall
      const completedAgentResult = this.context.agentResultCache?.get(this.agentRole)
      if (!completedAgentResult) throw new Error('提示词 Agent 首次执行失败，无法复用结果')
      return reuseAgentGeneration(this.context, this.agentRole, completedAgentResult)
    }
    let releaseAgentLock
    if (isDomainAgentRole(this.agentRole)) {
      const agentLock = new Promise((resolve) => {
        releaseAgentLock = resolve
      })
      this.context.agentResultLocks.set(this.agentRole, agentLock)
    }
    this.context.modelCallCount += 1
    if (this.context.modelCallCount > MAX_MODEL_CALLS) {
      releaseAgentLock?.()
      this.context.agentResultLocks.delete(this.agentRole)
      throw new Error('AI 规划步骤过多，已自动停止。请将任务拆分成更小的目标后重试。')
    }
    const invocationId = `agent_invocation_${randomUUID()}`
    emit(this.context, 'agent.started', {
      invocationId,
      agentRole: this.agentRole,
      call: this.context.modelCallCount
    })
    try {
      const response = await abortable(
        rpc.request(
          'model.chat',
          {
            providerId: this.providerId,
            modelId: this.modelId,
            messages: compactModelMessages(messages),
            tools: this.boundTools.map((item) => convertToOpenAITool(item)),
            temperature: options?.temperature,
            agentContext: {
              runId: this.context.runId,
              requestId: this.context.requestId,
              projectId: this.context.projectId,
              streamToUser: this.streamToUser
            }
          },
          100000
        ),
        options?.signal
      )
      const toolCalls = (response.toolCalls || []).map((call) => ({
        id: call.id || `tool_${randomUUID()}`,
        name: call.name,
        args: call.args || {},
        type: 'tool_call'
      }))
      const message = new AIMessage({
        content: response.content || '',
        tool_calls: toolCalls,
        usage_metadata: response.usage
          ? {
              input_tokens: response.usage.inputTokens || 0,
              output_tokens: response.usage.outputTokens || 0,
              total_tokens:
                response.usage.totalTokens ||
                (response.usage.inputTokens || 0) + (response.usage.outputTokens || 0)
            }
          : undefined
      })
      emit(this.context, 'agent.completed', {
        invocationId,
        agentRole: this.agentRole,
        hasToolCalls: toolCalls.length > 0
      })
      if (isDomainAgentRole(this.agentRole)) {
        this.context.agentResultCache ??= new Map()
        this.context.agentResultCache.set(this.agentRole, {
          content: response.content || ''
        })
      }
      return {
        generations: [{ text: response.content || '', message }],
        llmOutput: { tokenUsage: response.usage || {} }
      }
    } catch (error) {
      emit(this.context, 'agent.failed', {
        invocationId,
        agentRole: this.agentRole,
        error: error?.message || String(error)
      })
      throw error
    } finally {
      releaseAgentLock?.()
      this.context.agentResultLocks.delete(this.agentRole)
    }
  }
}

function isDomainAgentRole(agentRole) {
  return agentRole !== 'orchestrator' && agentRole.endsWith('-agent')
}

function reuseAgentGeneration(context, agentRole, cachedAgentResult) {
  const invocationId = `agent_invocation_${randomUUID()}`
  emit(context, 'agent.reused', { invocationId, agentRole })
  const message = new AIMessage({ content: cachedAgentResult.content })
  return {
    generations: [{ text: cachedAgentResult.content, message }],
    llmOutput: { tokenUsage: {} }
  }
}

class DurableMemorySaver extends MemorySaver {
  async hydrate() {
    const saved = await rpc.request('core.checkpoint_load')
    if (saved?.storage) this.storage = saved.storage
    if (saved?.writes) this.writes = saved.writes
  }

  async persist() {
    await rpc.request('core.checkpoint_save', {
      state: { storage: this.storage, writes: this.writes }
    })
  }

  async put(config, checkpoint, metadata) {
    const result = await super.put(config, checkpoint, metadata)
    await this.persist()
    return result
  }

  async putWrites(config, writes, taskId) {
    await super.putWrites(config, writes, taskId)
    await this.persist()
  }

  async deleteThread(threadId) {
    await super.deleteThread(threadId)
    await this.persist()
  }
}

const operationSchema = z
  .object({
    op: z.enum(['createNode', 'updateNode', 'moveNode', 'deleteNode', 'connect']),
    tempId: z.string().optional(),
    kind: z.enum(['image', 'video', 'audio', 'text', 'default']).optional(),
    nodeRef: z.string().optional(),
    sourceRef: z.string().optional(),
    targetRef: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    name: z.string().max(100).optional(),
    prompt: z.string().max(20000).optional(),
    text: z.string().max(20000).optional(),
    providerId: z.string().optional(),
    model: z.string().optional(),
    sizeSpecId: z.string().optional(),
    ratio: z.string().optional(),
    resolution: z.string().optional(),
    requestSize: z.string().optional(),
    updates: z
      .object({
        name: z.string().max(100).optional(),
        prompt: z.string().max(20000).optional(),
        text: z.string().max(20000).optional(),
        providerId: z.string().optional(),
        model: z.string().optional(),
        sizeSpecId: z.string().optional(),
        ratio: z.string().optional(),
        resolution: z.string().optional(),
        requestSize: z.string().optional()
      })
      .optional()
  })
  .strict()

function createTools(context) {
  const call = (name, description, schema) =>
    tool(
      async (args) => {
        const invocationId = `tool_invocation_${randomUUID()}`
        emit(context, 'tool.started', { invocationId, name, args })
        try {
          let result = await rpc.request('core.agent_tool', { name, args, context })
          if (name === 'canvas_find_nodes' && result?.status === 'ambiguous') {
            const selection = interrupt({
              kind: 'node_selection',
              query: result.query,
              reason: `“${result.query}”匹配到多个节点，请选择本次操作的目标节点。`,
              candidates: result.candidates
            })
            if (selection?.canceled) {
              result = { status: 'canceled', query: result.query }
            } else {
              result = await rpc.request('core.agent_tool', {
                name: 'human_select_node',
                args: {
                  query: result.query,
                  candidates: result.candidates,
                  selectedNodeId: selection?.selectedNodeId
                },
                context
              })
            }
          }
          emit(context, 'tool.completed', {
            invocationId,
            name,
            result: compactResult(result)
          })
          return JSON.stringify(result)
        } catch (error) {
          if (isGraphInterrupt(error)) {
            emit(context, 'tool.awaiting_user', { invocationId, name })
            throw error
          }
          emit(context, 'tool.failed', {
            invocationId,
            name,
            error: error?.message || String(error)
          })
          throw error
        }
      },
      { name, description, schema }
    )

  const readTools = [
    call(
      'canvas_get_snapshot',
      '读取当前项目画布的版本、节点、连线和视口。这是理解现有画布的唯一可信来源。',
      z.object({})
    ),
    call(
      'canvas_find_nodes',
      '按用户给出的节点 ID、标题或名称查询画布节点。涉及指定节点的操作前必须调用；同名时返回候选项，禁止自行猜测。',
      z.object({ query: z.string().min(1).max(200) })
    ),
    call(
      'models_list',
      '列出当前启用的模型及其类型、尺寸规格。创建或生成节点前必须检查。',
      z.object({})
    ),
    call(
      'assets_list',
      '列出项目已有素材及其类型。只返回受管素材元数据，不暴露任意文件系统。',
      z.object({})
    ),
    call(
      'tasks_status',
      '查询项目生成任务的最新状态。',
      z.object({ taskIds: z.array(z.string()).max(50).optional() })
    )
  ]

  const writeTools = [
    call(
      'canvas_create_draft',
      '创建可预览的画布变更草稿，不会直接修改正式画布。',
      z.object({
        plan: z
          .object({
            title: z.string().min(1).max(120),
            summary: z.string().min(1).max(1200),
            steps: z.array(z.string().min(1).max(300)).max(30).default([])
          })
          .passthrough(),
        operations: z.array(operationSchema).min(1).max(80)
      })
    ),
    call(
      'canvas_commit_draft',
      '提交用户已经确认的画布草稿。该工具始终需要人工批准。',
      z.object({ draftId: z.string().min(1) })
    ),
    call(
      'canvas_apply_and_generate',
      '提交用户已经确认的新建媒体节点草稿，并为草稿中新建的图片节点创建生成任务。该工具始终需要人工批准。',
      z.object({ draftId: z.string().min(1) })
    )
  ]
  return {
    readTools,
    writeTools,
    all: [...readTools, ...writeTools]
  }
}

async function createRuntime(context) {
  const checkpointer = new DurableMemorySaver()
  await checkpointer.hydrate()
  const orchestratorModel = new RsclawChatModel({
    providerId: context.providerId,
    modelId: context.model,
    context,
    streamToUser: true,
    agentRole: 'orchestrator'
  })
  const tools = createTools(context)
  const agent = createDeepAgent({
    name: 'rsclaw-canvas-agent',
    model: orchestratorModel,
    tools: tools.all,
    subagents: [],
    checkpointer,
    backend: new StateBackend(),
    interruptOn: {
      canvas_commit_draft: { allowedDecisions: ['approve', 'reject'] },
      canvas_apply_and_generate: { allowedDecisions: ['approve', 'reject'] }
    },
    systemPrompt: `你是 rsclaw-canvas 的总控 Agent。你只负责任务编排、状态管理和工具决策；专业创作必须交给程序指定的领域 Agent，画布操作必须交给 Tool。

确定性路由：本轮是普通画布操作，不需要领域创作 Agent，禁止调用 task 委派工具。

工作规则：
1. 程序已经完成意图识别和 Skill 语义匹配，你不得重新选择 Agent 或调用 Skill 查询。有领域 Agent 时，自动匹配的完整 Skill 已直接注入；纯画布操作不得应用创作 Skill。
2. 每轮最多调用一次 canvas_get_snapshot；涉及模型或尺寸时最多调用一次 models_list。委派领域 Agent 时只传用户目标、数量和必要约束，不复制画布快照、Skill 模板或模型列表。
3. 领域 Agent 返回 CREATIVE_SPEC 后，必须原样使用 positivePrompt、providerId、modelId 和 sizeSpecId；禁止改写、扩写或重新创作提示词。
4. 用户要求只输出文字方案时，获得 CREATIVE_SPEC 后直接面向用户说明，禁止创建草稿和生成任务。
5. 对需要生成的新媒体：把 CREATIVE_SPEC.items 逐项转换为 canvas_create_draft 的 createNode 操作；prompt 使用 positivePrompt，providerId、model、sizeSpecId 必须原样传入。节点坐标由程序统一整理为网格，禁止为了排版额外创建 moveNode。
6. 创建草稿后必须调用 canvas_apply_and_generate 请求一次人工确认。确认后该 Tool 会同时提交新节点并创建图片生成任务；禁止只用文字询问用户。
7. 对移动、删除、连线、修改已有节点等不需要生成的操作，使用 canvas_commit_draft 请求人工确认。
8. 不读取或写入任意本地路径。仅当用户明确要求复用已有素材时调用一次 assets_list。
9. 工具返回版本冲突时，重新读取一次画布并创建新草稿，不覆盖用户的新改动。
10. 用户明确要求只输出文字方案时，只调用画布快照和本轮指定领域 Agent，然后直接回复。
11. Skill 内容仅供领域 Agent 创作；总控只能看到 Skill 名称，不得自行解释、重写或把它用于移动、删除、改名等画布操作。
12. 用户通过 @节点名、标题、名称或 ID 指定现有节点时，必须先调用 canvas_find_nodes；@ 只是明确的节点引用标记，查询时去掉 @。unique 时只使用返回的 selectedNodeId；ambiguous 时该工具会自动暂停并要求用户选择，恢复后只使用工具返回的 selectedNodeId；not_found 时向用户说明找不到。禁止绕过工具直接用文字询问或自行猜测。
13. 创建草稿时，updateNode、moveNode、deleteNode、connect 必须使用已经确认的节点 ID。删除、覆盖提示词、移动和连线都必须经过 canvas_commit_draft 的人工确认。
14. 优先使用最少步骤，不重复查询。最终用简洁中文面向用户说明进展，不暴露内部 JSON、思维过程或调度细节。`
  })
  return { agent, checkpointer }
}

async function runAgent(input) {
  const context = {
    runId: `agent_run_${randomUUID()}`,
    threadId: input.threadId || `${input.projectId}:${input.requestId}`,
    requestId: input.requestId,
    projectId: input.projectId,
    providerId: input.providerId,
    model: input.model,
    skillId: null,
    selectedSkill: null,
    skillBundle: null,
    agentRoute: null,
    specialistBrief: ''
  }
  context.metrics = { stepCount: 0, inputTokens: 0, outputTokens: 0 }
  context.modelCallCount = 0
  context.creativeModelCallCount = 0
  context.agentResultCache = new Map()
  context.agentResultLocks = new Map()
  const controller = new AbortController()
  controllers.set(context.requestId, controller)
  runControllers.set(context.runId, controller)
  let runCreated = false
  try {
    const preliminaryRoute = detectAgentRoute(input.content)
    context.agentRoute = preliminaryRoute
    const skillEligible = !['canvas_edit', 'regenerate'].includes(preliminaryRoute.action)
    if (skillEligible) {
      const enabledSkills = await rpc.request('core.invoke', {
        command: 'list_enabled_skills_for_agent',
        args: {}
      })
      context.skillBundle = buildNativeSkillBundle(enabledSkills)
    }
    await rpc.request('core.invoke', {
      command: 'create_agent_run',
      args: {
        ...context,
        skillBundle: context.skillBundle
          ? nativeSkillBundleSnapshot(context.skillBundle)
          : undefined,
        agentRoute: preliminaryRoute.intent,
        content: input.content
      }
    })
    runCreated = true
    await rpc.request('core.invoke', {
      command: 'insert_assistant_message',
      args: { projectId: context.projectId, role: 'user', content: input.content }
    })
    emit(context, 'run.started', { content: input.content })
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(AGENT_TIMEOUT_MS)])
    if (skillEligible) {
      const decision = await activateSkillForRequest(input, context, signal)
      context.agentRoute = applySkillSemanticDecision(
        input.content,
        context.selectedSkill,
        decision
      )
    }
    context.skillId = context.selectedSkill?.id || null
    context.specialistBrief = buildSpecialistBrief(input, context.selectedSkill)
    await rpc.request('core.invoke', {
      command: 'update_agent_run',
      args: { runId: context.runId, agentRoute: context.agentRoute.intent }
    })
    const isDirectCreative = ['role_design', 'visual_design'].includes(context.agentRoute.intent)
    if (
      isDirectCreative &&
      context.agentRoute.action === 'revise' &&
      !canRunDirectCreativeWorkflow(input, context.agentRoute)
    ) {
      const creativeContext = normalizeCreativeContext(input.canvasContextJson)
      const names = creativeContext.nodes.map((node) => node.name).filter(Boolean)
      const content = names.length
        ? `画布中有多个可修改的图片节点，请通过 @ 明确指定：${names.slice(0, 12).join('、')}。`
        : '当前画布中没有可修改的图片节点。'
      return completeDirectWorkflow(context, content)
    }
    if (
      isDirectCreative &&
      ['create', 'revise', 'analyze'].includes(context.agentRoute.action) &&
      canRunDirectCreativeWorkflow(input, context.agentRoute)
    ) {
      return runCreativeWorkflow(input, context, signal)
    }
    if (context.agentRoute.action === 'regenerate') {
      return runRegenerateWorkflow(input, context)
    }
    const runtime = await createRuntime(context)
    const content = buildPrompt(input, context)
    const result = await runtime.agent.invoke(
      { messages: [{ role: 'user', content }] },
      {
        configurable: { thread_id: context.threadId },
        signal,
        recursionLimit: 32,
        callbacks: [new AgentTelemetry(context)]
      }
    )
    return finishInvocation(context, result)
  } catch (error) {
    if (runCreated) return failInvocation(context, error)
    throw error
  } finally {
    controllers.delete(context.requestId)
    runControllers.delete(context.runId)
  }
}

async function resumeAgent(input) {
  const run = await rpc.request('core.invoke', {
    command: 'get_agent_run_context_for_agent',
    args: { runId: input.runId }
  })
  const previousEvents = await rpc.request('core.invoke', {
    command: 'list_agent_events',
    args: { runId: input.runId }
  })
  sequences.set(
    input.runId,
    previousEvents.reduce((maximum, event) => Math.max(maximum, event.sequence || 0), 0)
  )
  const guardedApproval = [...previousEvents]
    .reverse()
    .find(
      (event) => event.type === 'run.awaiting_approval' && event.payload?.source === 'draft_guard'
    )
  let selectedSkill = run.activatedSkill || null
  if (run.skillId && !selectedSkill && !run.skillBundle) {
    selectedSkill = await rpc.request('core.invoke', {
      command: 'resolve_canvas_skill_for_agent',
      args: { id: run.skillId }
    })
  }
  if (run.skillId && !selectedSkill && !guardedApproval) {
    throw new Error('本轮使用的 Skill 快照不存在，无法安全继续执行')
  }
  const context = {
    runId: run.id,
    threadId: run.threadId,
    requestId: run.requestId,
    projectId: run.projectId,
    providerId: run.providerId,
    model: run.modelId,
    skillId: run.skillId || null,
    selectedSkill,
    skillBundle: run.skillBundle || null,
    agentRoute: detectAgentRoute(run.inputText, selectedSkill),
    specialistBrief: buildSpecialistBrief(
      {
        content: run.inputText
      },
      selectedSkill
    )
  }
  context.metrics = {
    stepCount: run.stepCount || 0,
    inputTokens: run.inputTokens || 0,
    outputTokens: run.outputTokens || 0
  }
  context.modelCallCount = 0
  context.creativeModelCallCount = 0
  context.agentResultCache = new Map()
  context.agentResultLocks = new Map()
  if (
    Array.isArray(input.decisions) &&
    input.decisions.some((decision) => decision?.type === 'reject')
  ) {
    await rpc.request('core.invoke', {
      command: 'reject_agent_drafts',
      args: { runId: context.runId }
    })
  }
  const controller = new AbortController()
  controllers.set(context.requestId, controller)
  runControllers.set(context.runId, controller)
  emit(context, 'run.resumed', { decisions: input.decisions })
  try {
    if (guardedApproval) {
      return resolveGuardedDraft(context, guardedApproval.payload, input.decisions)
    }
    const runtime = await createRuntime(context)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(AGENT_TIMEOUT_MS)])
    const resumeValue = Array.isArray(input.decisions)
      ? { decisions: input.decisions }
      : input.decisions
    const result = await runtime.agent.invoke(new Command({ resume: resumeValue }), {
      configurable: { thread_id: context.threadId },
      signal,
      recursionLimit: 32,
      callbacks: [new AgentTelemetry(context)]
    })
    return finishInvocation(context, result)
  } catch (error) {
    if (isCanvasVersionConflict(error)) {
      try {
        return await recoverDraftConflict(context)
      } catch (recoveryError) {
        return failInvocation(context, recoveryError)
      }
    }
    return failInvocation(context, error)
  } finally {
    controllers.delete(context.requestId)
    runControllers.delete(context.runId)
  }
}

function cancelAgent({ requestId, runId }) {
  const controller =
    (requestId && controllers.get(requestId)) || (runId && runControllers.get(runId))
  if (!controller) return { canceled: false }
  controller.abort()
  return { canceled: true }
}

async function runCreativeWorkflow(input, context, signal) {
  const action = context.agentRoute.action
  const creativeContext = await loadCreativeContext(input, context)
  if (action === 'analyze') {
    const content = await callDirectRoleModel(
      context,
      [
        {
          role: 'system',
          content: `${creativeSkillContext(context)}

你是 rsclaw-canvas 的创意设计分析师。本轮只分析和回答，不创建节点、不输出 JSON、不操作画布。用简洁中文直接回答用户。`
        },
        {
          role: 'user',
          content: `用户需求：${input.content}

现有图片节点摘要：
${JSON.stringify(compactCreativeContext(creativeContext))}`
        }
      ],
      signal
    )
    return completeDirectWorkflow(context, content || '已完成创意设计分析。')
  }

  const expectedCount = expectedCreativeItemCount(input.content)
  const requestedRatio = inferRequestedRatio(input.content, context.selectedSkill)
  const revisionTargetId =
    action === 'revise' ? resolveRevisionTargetId(input.content, creativeContext.nodes) : null
  const allowedNodeIds = revisionTargetId
    ? [revisionTargetId]
    : creativeContext.nodes.map((node) => node.id)
  const systemPrompt = buildDirectCreativeSystemPrompt(context, action)
  const userPrompt = `用户需求：${input.content}

程序提供的现有图片节点上下文：
${JSON.stringify(compactCreativeContext(creativeContext))}

${expectedCount ? `必须返回 ${expectedCount} 个 items。` : ''}
${action === 'revise' ? `targetNodeId 必须严格使用 ${revisionTargetId}。` : ''}`
  let raw = await callDirectRoleModel(
    context,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    signal
  )
  let spec
  const expectedType = context.agentRoute.intent
  try {
    spec = parseCreativeSpec(raw, { action, expectedCount, expectedType, allowedNodeIds })
  } catch (error) {
    raw = await callDirectRoleModel(
      context,
      [
        {
          role: 'system',
          content: `${systemPrompt}

上一次结果未通过程序校验。只修复 JSON，不解释，不改变用户需求。`
        },
        {
          role: 'user',
          content: `${userPrompt}

校验错误：${error.message}

上一次结果：
${String(raw).slice(0, 8000)}`
        }
      ],
      signal
    )
    spec = parseCreativeSpec(raw, { action, expectedCount, expectedType, allowedNodeIds })
  }

  if (context.agentRoute.textOnly) {
    return completeDirectWorkflow(context, formatCreativeSpecText(spec, action))
  }
  const operations = buildRoleCanvasOperations(spec, {
    action,
    context: creativeContext,
    requestedRatio
  })
  if (!operations.length) throw new Error('创意 Agent 没有生成可执行的画布操作')
  const draft = await callCoreAgentTool(context, 'canvas_create_draft', {
    plan: draftPlanFromCreativeSpec(spec, action),
    operations
  })
  return requestDraftApproval(context, draft.id, {
    content: `${context.agentRoute.intent === 'role_design' ? '角色' : '视觉'}${
      action === 'revise' ? '修改' : '创作'
    }草稿和图片生成任务已经准备好，等待你的确认后执行。`
  })
}

async function runRegenerateWorkflow(input, context) {
  const creativeContext = await loadCreativeContext(input, context)
  const targetId = resolveRevisionTargetId(input.content, creativeContext.nodes)
  if (!targetId) {
    const names = creativeContext.nodes.map((node) => node.name).filter(Boolean)
    const content = names.length
      ? `请通过 @ 明确指定要重新生成的图片节点：${names.slice(0, 12).join('、')}。`
      : '当前画布中没有可重新生成的图片节点。'
    return completeDirectWorkflow(context, content)
  }
  const target = creativeContext.nodes.find((node) => node.id === targetId)
  if (!target?.prompt) throw new Error('目标节点没有可用于重新生成的提示词')
  const draft = await callCoreAgentTool(context, 'canvas_create_draft', {
    plan: {
      title: `重新生成 ${target.name}`,
      summary: '沿用该节点当前的提示词、模型、尺寸和参考关系重新生成图片。',
      steps: [`重新生成图片节点：${target.name}`]
    },
    operations: [
      {
        op: 'updateNode',
        nodeRef: target.id,
        updates: {
          prompt: target.prompt
        }
      }
    ]
  })
  return requestDraftApproval(context, draft.id, {
    content: '图片重新生成任务已经准备好，等待你的确认后执行。'
  })
}

async function loadCreativeContext(input, context) {
  const base = normalizeCreativeContext(input.canvasContextJson)
  try {
    const project = await rpc.request('core.invoke', {
      command: 'get_project',
      args: { id: context.projectId }
    })
    const canvas = JSON.parse(project.canvasJson || '{}')
    const nodes = (canvas.nodes || [])
      .filter((node) => node?.type === 'image')
      .slice(-24)
      .map((node) => ({
        id: String(node.id || ''),
        name: String(node.data?.name || node.data?.title || node.id || '').slice(0, 100),
        prompt: String(node.data?.prompt || '').slice(0, 20000),
        providerId: String(node.data?.providerId || ''),
        model: String(node.data?.model || ''),
        sizeSpecId: String(node.data?.sizeSpecId || ''),
        ratio: String(node.data?.ratio || node.data?.aspectRatio || ''),
        resolution: String(node.data?.resolution || ''),
        position: {
          x: Number(node.position?.x || 0),
          y: Number(node.position?.y || 0)
        }
      }))
      .filter((node) => node.id)
    return { ...base, nodes }
  } catch {
    return base
  }
}

function canRunDirectCreativeWorkflow(input, route) {
  if (route.action !== 'revise') return true
  const context = normalizeCreativeContext(input.canvasContextJson)
  return Boolean(resolveRevisionTargetId(input.content, context.nodes))
}

function buildDirectCreativeSystemPrompt(context, action) {
  const isRoleDesign = context.agentRoute?.intent === 'role_design'
  const creativeType = isRoleDesign ? 'role_design' : 'visual_design'
  const subject = isRoleDesign ? '角色' : '视觉内容'
  const revisionRules =
    action === 'revise'
      ? `- 每个 item 必须提供 existingCharacters 中真实存在的 targetNodeId。
- 用户要求保留原角色、再做一版或创建版本时，updateMode 使用 variant；否则使用 update。
- 保留用户没有要求修改的主体、构图和风格特征，不要把局部修改变成完全不同的内容。`
      : `- items 数量必须与用户要求一致。
- 多个内容需在同一风格体系下保持清晰差异和统一的视觉语言。`
  return `你是 rsclaw-canvas 的${subject}设计 Agent。你只负责创作，不调用工具。

${creativeSkillContext(context)}

只返回以下 CREATIVE_SPEC JSON，不添加 Markdown 或解释：
{
  "type": "${creativeType}",
  "summary": "本次设计或修改方向",
  "items": [{
    "name": "角色名称",
    "description": "角色核心设定摘要",
    "positivePrompt": "可直接用于生图的完整提示词",
    "targetNodeId": "仅修改任务填写",
    "updateMode": "update 或 variant"
  }]
}

要求：
${revisionRules}
- 不选择供应商、模型、尺寸或节点坐标，这些由程序决定。
- name、description、positivePrompt 必须使用简体中文；仅 3D、PBR、SSS 等无法合理翻译的技术缩写可以保留英文。
- positivePrompt 必须以中文为主体、自包含且可直接生图；禁止返回整段英文提示词。
- 不生成、附加或返回负面提示词。
- 只返回合法 JSON。`
}

function creativeSkillContext(context) {
  if (!context.selectedSkill) return '本轮没有匹配到需要额外应用的 Skill 创作约束。'
  return `系统根据本轮语义自动匹配的创作要求：
名称：${context.selectedSkill.name}
说明：${context.selectedSkill.description || '无'}
内容：
${String(context.selectedSkill.promptTemplate || '').slice(0, 8000)}`
}

async function callDirectRoleModel(context, messages, signal) {
  context.creativeModelCallCount += 1
  if (context.creativeModelCallCount > 2) {
    throw new Error('创意设计结果连续两次未通过校验')
  }
  context.modelCallCount += 1
  if (context.modelCallCount > MAX_MODEL_CALLS) {
    throw new Error('AI 规划步骤过多，已自动停止。请将任务拆分成更小的目标后重试。')
  }
  context.metrics.stepCount += 1
  const invocationId = `agent_invocation_${randomUUID()}`
  emit(context, 'model.started', { step: context.metrics.stepCount })
  emit(context, 'agent.started', {
    invocationId,
    agentRole:
      context.agentRoute?.intent === 'visual_design' ? 'visual-design-agent' : 'role-design-agent',
    call: context.modelCallCount
  })
  try {
    const response = await abortable(
      rpc.request(
        'model.chat',
        {
          providerId: context.providerId,
          modelId: context.model,
          messages,
          tools: [],
          temperature: 0.4,
          agentContext: {
            runId: context.runId,
            requestId: context.requestId,
            projectId: context.projectId,
            streamToUser: false
          }
        },
        100000
      ),
      signal
    )
    const usage = response.usage || {}
    context.metrics.inputTokens += usage.inputTokens || 0
    context.metrics.outputTokens += usage.outputTokens || 0
    emit(context, 'agent.completed', {
      invocationId,
      agentRole:
        context.agentRoute?.intent === 'visual_design'
          ? 'visual-design-agent'
          : 'role-design-agent',
      hasToolCalls: false
    })
    emit(context, 'model.completed', { ...context.metrics })
    return String(response.content || '').trim()
  } catch (error) {
    emit(context, 'agent.failed', {
      invocationId,
      agentRole:
        context.agentRoute?.intent === 'visual_design'
          ? 'visual-design-agent'
          : 'role-design-agent',
      error: error?.message || String(error)
    })
    throw error
  }
}

async function callCoreAgentTool(context, name, args) {
  const invocationId = `tool_invocation_${randomUUID()}`
  emit(context, 'tool.started', { invocationId, name, args })
  try {
    const result = await rpc.request('core.agent_tool', { name, args, context })
    emit(context, 'tool.completed', {
      invocationId,
      name,
      result: compactResult(result)
    })
    return result
  } catch (error) {
    emit(context, 'tool.failed', {
      invocationId,
      name,
      error: error?.message || String(error)
    })
    throw error
  }
}

async function requestDraftApproval(context, draftId, { content } = {}) {
  const interruption = {
    source: 'draft_guard',
    actionRequests: [
      {
        name: 'canvas_apply_and_generate',
        args: { draftId }
      }
    ],
    reviewConfigs: [
      {
        actionName: 'canvas_apply_and_generate',
        allowedDecisions: ['approve', 'reject']
      }
    ]
  }
  await updateRun(context.runId, 'awaiting_approval', undefined, context.metrics)
  emit(context, 'run.awaiting_approval', interruption)
  await resolveApprovalMessages(context.runId, 'superseded')
  const message = await rpc.request('core.invoke', {
    command: 'insert_assistant_message',
    args: {
      projectId: context.projectId,
      role: 'assistant',
      content: content || '画布草稿已经重新准备好，等待你的确认后执行。',
      actions: await approvalMessageActions(context, interruption)
    }
  })
  return {
    message,
    actions: [],
    agentRun: await getRun(context.runId),
    approval: normalizeApproval(interruption)
  }
}

async function completeDirectWorkflow(context, content) {
  const safeContent = String(content || '').trim() || '已完成本次任务。'
  const message = await rpc.request('core.invoke', {
    command: 'insert_assistant_message',
    args: { projectId: context.projectId, role: 'assistant', content: safeContent }
  })
  await updateRun(context.runId, 'completed', undefined, context.metrics)
  emit(context, 'run.completed', { content: safeContent })
  return {
    message,
    actions: [],
    agentRun: await getRun(context.runId),
    approval: null
  }
}

async function recoverDraftConflict(context) {
  const proposedDraft = await rpc.request('core.invoke', {
    command: 'get_proposed_agent_draft',
    args: { runId: context.runId }
  })
  if (!proposedDraft) throw new Error('画布已发生变化，且没有可重建的草稿')
  await rpc.request('core.invoke', {
    command: 'reject_agent_drafts',
    args: { runId: context.runId }
  })
  const latestProject = await rpc.request('core.invoke', {
    command: 'get_project',
    args: { id: context.projectId }
  })
  const latestCanvas = JSON.parse(latestProject.canvasJson || '{"nodes":[],"edges":[]}')
  const operations = reflowCreateNodeOperations(proposedDraft.operations, latestCanvas.nodes || [])
  const draft = await callCoreAgentTool(context, 'canvas_create_draft', {
    plan: proposedDraft.plan,
    operations
  })
  return requestDraftApproval(context, draft.id, {
    content: '审批期间画布发生了变化，已基于最新画布重建草稿，请再次确认。'
  })
}

function isCanvasVersionConflict(error) {
  return /CANVAS_VERSION_CONFLICT|画布已在审批期间发生修改/i.test(error?.message || String(error))
}

async function finishInvocation(context, result) {
  const interruption = result?.__interrupt__?.[0]?.value
  if (interruption) {
    await updateRun(context.runId, 'awaiting_approval', undefined, context.metrics)
    emit(context, 'run.awaiting_approval', interruption)
    const message = await rpc.request('core.invoke', {
      command: 'insert_assistant_message',
      args: {
        projectId: context.projectId,
        role: 'assistant',
        content: approvalSummary(interruption),
        actions: await approvalMessageActions(context, interruption)
      }
    })
    return {
      message,
      actions: [],
      agentRun: await getRun(context.runId),
      approval: normalizeApproval(interruption)
    }
  }
  const proposedDraft = await rpc.request('core.invoke', {
    command: 'get_proposed_agent_draft',
    args: { runId: context.runId }
  })
  if (proposedDraft) {
    if (context.agentRoute?.textOnly) {
      await rpc.request('core.invoke', {
        command: 'reject_agent_drafts',
        args: { runId: context.runId }
      })
    } else {
      const guardedActionName = context.agentRoute?.shouldGenerate
        ? 'canvas_apply_and_generate'
        : 'canvas_commit_draft'
      const guardedInterruption = {
        source: 'draft_guard',
        actionRequests: [
          {
            name: guardedActionName,
            args: { draftId: proposedDraft.id }
          }
        ],
        reviewConfigs: [
          {
            actionName: guardedActionName,
            allowedDecisions: ['approve', 'reject']
          }
        ]
      }
      await updateRun(context.runId, 'awaiting_approval', undefined, context.metrics)
      emit(context, 'run.awaiting_approval', guardedInterruption)
      const message = await rpc.request('core.invoke', {
        command: 'insert_assistant_message',
        args: {
          projectId: context.projectId,
          role: 'assistant',
          content: context.agentRoute?.shouldGenerate
            ? '角色草稿和图片生成任务已经准备好，等待你的确认后执行。'
            : '画布变更草稿已经准备好，等待你的确认后应用。',
          actions: await approvalMessageActions(context, guardedInterruption)
        }
      })
      return {
        message,
        actions: [],
        agentRun: await getRun(context.runId),
        approval: normalizeApproval(guardedInterruption)
      }
    }
  }
  if (context.agentRoute?.shouldGenerate && !context.agentRoute?.textOnly) {
    throw new Error('Agent 未创建可执行的画布草稿，本次运行不能标记为完成')
  }
  const content = lastAssistantText(result?.messages) || '已完成本次画布规划。'
  const message = await rpc.request('core.invoke', {
    command: 'insert_assistant_message',
    args: { projectId: context.projectId, role: 'assistant', content }
  })
  await updateRun(context.runId, 'completed', undefined, context.metrics)
  emit(context, 'run.completed', { content })
  return {
    message,
    actions: [],
    agentRun: await getRun(context.runId),
    approval: null
  }
}

async function resolveGuardedDraft(context, interruption, decisions) {
  const request = interruption.actionRequests?.find((item) =>
    ['canvas_commit_draft', 'canvas_apply_and_generate'].includes(item.name)
  )
  const draftId = request?.args?.draftId
  if (!draftId) throw new Error('待确认的画布草稿不存在')
  const toolName = request.name
  const reviewDecision = Array.isArray(decisions) ? decisions[0] : null
  const decision = reviewDecision?.type
  const promptEdits = decision === 'approve' ? normalizePromptEdits(reviewDecision) : []
  let content
  if (decision === 'approve') {
    const invocationId = `tool_invocation_${randomUUID()}`
    emit(context, 'tool.started', {
      invocationId,
      name: toolName,
      args: { draftId }
    })
    try {
      const result = await rpc.request('core.agent_tool', {
        name: toolName,
        args: { draftId, promptEdits },
        context
      })
      emit(context, 'tool.completed', {
        invocationId,
        name: toolName,
        result: compactResult(result)
      })
      content =
        toolName === 'canvas_apply_and_generate'
          ? `已创建画布节点，并提交 ${result.tasks?.length || 0} 个图片生成任务。`
          : '已应用你确认的画布草稿。'
    } catch (error) {
      emit(context, 'tool.failed', {
        invocationId,
        name: toolName,
        error: error?.message || String(error)
      })
      if (!isCanvasVersionConflict(error)) {
        await resolveApprovalMessages(
          context.runId,
          'failed',
          `执行失败：${error?.message || String(error)}`,
          promptEdits
        ).catch(() => {})
      }
      throw error
    }
  } else {
    await rpc.request('core.invoke', {
      command: 'reject_agent_drafts',
      args: { runId: context.runId }
    })
    content = '已取消，本次画布草稿未应用。'
  }
  await resolveApprovalMessages(
    context.runId,
    decision === 'approve' ? 'approved' : 'rejected',
    content,
    promptEdits
  )
  const message = await rpc.request('core.invoke', {
    command: 'insert_assistant_message',
    args: { projectId: context.projectId, role: 'assistant', content }
  })
  await updateRun(context.runId, 'completed', undefined, context.metrics)
  emit(context, 'run.completed', { content })
  return {
    message,
    actions: [],
    agentRun: await getRun(context.runId),
    approval: null
  }
}

async function failInvocation(context, error) {
  const message = error?.message || String(error)
  const timedOut =
    error?.name === 'TimeoutError' || /timed?\s*out|timeout|超过 3 分钟/i.test(message)
  const canceled = !timedOut && (error?.name === 'AbortError' || /abort/i.test(message))
  const status = canceled ? 'canceled' : 'failed'
  const friendlyMessage = timedOut
    ? 'AI 助手执行超过 3 分钟，已自动停止。请缩小任务范围后重试。'
    : message
  await resolveApprovalMessages(
    context.runId,
    canceled ? 'rejected' : 'failed',
    canceled ? '已停止执行' : `执行失败：${friendlyMessage}`
  ).catch(() => {})
  await updateRun(context.runId, status, friendlyMessage, context.metrics)
  emit(context, `run.${status}`, { error: friendlyMessage })
  if (canceled) throw new Error('已停止执行')
  await rpc.request('core.invoke', {
    command: 'insert_assistant_message',
    args: {
      projectId: context.projectId,
      role: 'assistant',
      content: `执行失败：${friendlyMessage}`
    }
  })
  throw new Error(friendlyMessage)
}

function emit(context, type, payload = {}) {
  const sequence = (sequences.get(context.runId) || 0) + 1
  sequences.set(context.runId, sequence)
  rpc.emit({
    type: 'agent.event',
    data: {
      runId: context.runId,
      requestId: context.requestId,
      sequence,
      type,
      payload,
      projectId: context.projectId
    }
  })
}

async function updateRun(runId, status, errorMessage = undefined, metrics = {}) {
  return rpc.request('core.invoke', {
    command: 'update_agent_run',
    args: { runId, status, errorMessage, ...metrics }
  })
}

async function getRun(runId) {
  return rpc.request('core.invoke', {
    command: 'get_agent_run',
    args: { runId }
  })
}

function buildPrompt(input, context) {
  const route = context.agentRoute
  const sections = [
    `用户原始需求：${input.content}`,
    route?.subagent
      ? `程序路由结果：${route.intent}。必须且只能通过 task 调用一次 ${route.subagent}，把返回的 CREATIVE_SPEC 用于后续工具操作。`
      : '程序路由结果：general。本轮禁止调用 task，不需要领域创作 Agent。'
  ]
  if (context.selectedSkill && route?.subagent) {
    sections.push(
      `系统根据本轮语义自动匹配了 Skill：${context.selectedSkill.name}。完整 Skill 已由程序注入 ${route.subagent}，总控不得查询、解释或改写。`
    )
  } else if (context.selectedSkill) {
    sections.push(
      `系统匹配了 Skill“${context.selectedSkill.name}”，但本轮是非创作画布操作，不应用其创作内容。`
    )
  }
  if (route?.textOnly) {
    sections.push('本轮是纯文字交付：禁止创建画布草稿，禁止创建生成任务。')
  } else if (route?.shouldGenerate) {
    sections.push(
      '本轮需要生成媒体：先创建画布草稿，再调用 canvas_apply_and_generate 请求用户确认。'
    )
  }
  return sections.join('\n\n')
}

function buildSpecialistBrief(input, selectedSkill = null) {
  const sections = [`用户目标：${String(input.content || '').slice(0, 2000)}`]
  if (input.canvasContextJson) {
    sections.push(`精简画布与模型摘要：${String(input.canvasContextJson).slice(0, 4500)}`)
  }
  if (selectedSkill) sections.push(`自动匹配的 Skill：${selectedSkill.name}`)
  return sections.join('\n\n')
}

async function activateSkillForRequest(input, context, signal) {
  const bundle = context.skillBundle
  if (!bundle?.skills?.length) return null
  const deniedSkillIds = explicitlyDeniedSkillIds(input.content, bundle.skills)
  const activationMiddleware = createSingleSkillActivationMiddleware({
    skills: bundle.skills,
    deniedSkillIds,
    onActivated: async (skill) => {
      context.selectedSkill = skill
      context.skillId = skill.id
      await rpc.request('core.invoke', {
        command: 'activate_agent_skill',
        args: {
          runId: context.runId,
          skillId: skill.id,
          skillPath: skill.path,
          contentHash: skill.contentHash
        }
      })
      emit(context, 'skill.activated', {
        skillId: skill.id,
        skillName: skill.name,
        revision: skill.revision
      })
    },
    onRejected: async (skill, reason) => {
      emit(context, 'skill.activation_rejected', {
        skillId: skill.id,
        skillName: skill.name,
        reason
      })
    }
  })
  const model = new RsclawChatModel({
    providerId: context.providerId,
    modelId: context.model,
    context,
    streamToUser: false,
    agentRole: 'skill-router'
  })
  const agent = createDeepAgent({
    name: 'rsclaw-skill-router',
    model,
    tools: [],
    subagents: [],
    backend: new StateBackend(),
    skills: bundle.sources,
    permissions: [
      { operations: ['read'], paths: ['/skills/**'], mode: 'allow' },
      { operations: ['read'], paths: ['/**'], mode: 'deny' },
      { operations: ['write'], paths: ['/**'], mode: 'deny' }
    ],
    middleware: [activationMiddleware],
    systemPrompt: `你是 rsclaw-canvas 的只读 Skill Agent。根据用户本轮请求判断是否需要使用可用 Skill，并给出安全的语义路由建议。

规则：
1. Skill 的名称和说明只用于发现。只有在请求目标与某个 Skill 明确匹配时，才用 read_file 读取其 SKILL.md；成功读取才算激活。
2. 每轮最多读取一个 Skill 的 SKILL.md。不要组合 Skill，不要读取与请求无关的 Skill。
3. 用户明确说不要使用、禁止使用或不用某 Skill 时，不得读取该 Skill。
4. 画布移动、删除、改名、连线、状态查询和原样重新生成不应用 Skill。
5. Skill 只是创作规则，不是操作授权。你不能修改画布、创建草稿、选择真实节点、供应商、模型、尺寸或执行生成。
6. 判断完成后只返回 JSON：
{"intent":"role_design|visual_design|general","action":"create|revise|analyze|general","textOnly":true|false}
7. 角色、人设、人物设定类创作使用 role_design；海报、分镜、场景、插画等画面创作使用 visual_design；不属于创作则使用 general。`
  })
  const deniedNames = bundle.skills
    .filter((skill) => deniedSkillIds.has(skill.id))
    .map((skill) => skill.name)
  const initialMessage = {
    role: 'user',
    content: `用户本轮请求：${String(input.content || '').slice(0, 4000)}

${deniedNames.length ? `用户明确排除的 Skill：${deniedNames.join('、')}` : '没有检测到明确排除的 Skill。'}`
  }
  const invokeConfig = {
    configurable: { thread_id: `${context.threadId}:skill:${context.runId}` },
    signal,
    recursionLimit: 12,
    callbacks: [new AgentTelemetry(context)]
  }
  let result = await agent.invoke(
    {
      messages: [initialMessage],
      files: bundle.files
    },
    invokeConfig
  )
  let decision = parseSkillSemanticDecision(lastAssistantText(result.messages))
  if (
    context.selectedSkill &&
    (!decision || decision.intent === 'general' || decision.action === 'general')
  ) {
    result = await agent.invoke(
      {
        messages: [
          ...result.messages,
          {
            role: 'user',
            content:
              '你已经读取并激活了一个创作 Skill。上一次语义路由无效；请严格按照约定 JSON，明确返回 role_design 或 visual_design，以及 create、revise 或 analyze。'
          }
        ],
        files: bundle.files
      },
      invokeConfig
    )
    decision = parseSkillSemanticDecision(lastAssistantText(result.messages))
  }
  if (
    context.selectedSkill &&
    (!decision || decision.intent === 'general' || decision.action === 'general')
  ) {
    throw new Error('Skill Agent 已激活 Skill，但没有返回合法的创作语义路由')
  }
  return decision
}

function applySkillSemanticDecision(content, selectedSkill, decision) {
  const route = detectAgentRoute(content, selectedSkill)
  if (['canvas_edit', 'regenerate'].includes(route.action)) return route
  if (!selectedSkill || !decision || route.intent !== 'general') return route
  if (!['role_design', 'visual_design'].includes(decision.intent)) return route
  if (!['create', 'revise', 'analyze'].includes(decision.action)) return route
  const textOnly = route.textOnly || decision.textOnly || decision.action === 'analyze'
  return {
    intent: decision.intent,
    subagent: decision.intent === 'role_design' ? 'role-design-agent' : 'visual-design-agent',
    shouldGenerate: !textOnly && decision.action !== 'analyze',
    textOnly,
    action: decision.action
  }
}

function serializeMessage(message) {
  const type = message._getType?.() || 'human'
  const result = {
    role: { human: 'user', ai: 'assistant', system: 'system', tool: 'tool' }[type] || 'user',
    content: message.content
  }
  if (message.tool_calls?.length) {
    result.tool_calls = message.tool_calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args || {}) }
    }))
  }
  if (message.tool_call_id) result.tool_call_id = message.tool_call_id
  if (message.name) result.name = message.name
  return result
}

function compactModelMessages(messages) {
  return messages.map((message) => {
    const serialized = serializeMessage(message)
    const limits = { system: 26000, user: 5000, assistant: 7000, tool: 6000 }
    serialized.content = truncateContent(serialized.content, limits[serialized.role] || limits.user)
    return serialized
  })
}

function truncateContent(content, limit) {
  if (typeof content === 'string') {
    return content.length > limit ? `${content.slice(0, limit)}\n…（内容已截断）` : content
  }
  if (!Array.isArray(content)) return content
  const text = JSON.stringify(content)
  return text.length > limit ? `${text.slice(0, limit)}\n…（内容已截断）` : content
}

function lastAssistantText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const type = message?._getType?.() || message?.type || message?.role
    if (!['ai', 'assistant'].includes(type)) continue
    if (typeof message.content === 'string' && message.content.trim()) return message.content.trim()
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part) => part?.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  return ''
}

function normalizeInterruption(interruption) {
  return {
    actionRequests: interruption.actionRequests || interruption.action_requests || [],
    reviewConfigs: interruption.reviewConfigs || interruption.review_configs || []
  }
}

function normalizePromptEdits(reviewDecision) {
  if (Array.isArray(reviewDecision?.promptEdits)) {
    return reviewDecision.promptEdits
      .filter((edit) => typeof edit?.prompt === 'string' && Number.isInteger(edit?.operationIndex))
      .map((edit) => ({
        prompt: edit.prompt,
        operationIndex: edit.operationIndex
      }))
  }
  if (
    typeof reviewDecision?.editedPrompt === 'string' &&
    Number.isInteger(reviewDecision?.promptOperationIndex)
  ) {
    return [
      {
        prompt: reviewDecision.editedPrompt,
        operationIndex: reviewDecision.promptOperationIndex
      }
    ]
  }
  return []
}

async function approvalMessageActions(context, interruption) {
  if (interruption?.kind === 'node_selection') return []
  const approval = normalizeInterruption(interruption)
  const request = approval.actionRequests.find((item) =>
    ['canvas_commit_draft', 'canvas_apply_and_generate'].includes(item.name)
  )
  const draftId = request?.args?.draftId
  if (!draftId) return []
  const draft = await rpc.request('core.invoke', {
    command: 'get_agent_draft',
    args: { draftId }
  })
  return [
    {
      type: 'agent_approval',
      version: 1,
      runId: context.runId,
      draftId,
      status: 'pending',
      actionName: request.name,
      itemLabel: context.agentRoute?.intent === 'role_design' ? '角色卡' : '节点',
      title: draft.plan?.title || approvalSummary(interruption),
      summary: draft.plan?.summary || '',
      items: approvalRecordItems(draft.operations || [])
    }
  ]
}

async function resolveApprovalMessages(runId, status, summary = '', promptEdits = []) {
  return rpc.request('core.invoke', {
    command: 'resolve_assistant_approval_message',
    args: { runId, status, summary, promptEdits }
  })
}

function normalizeApproval(interruption) {
  if (interruption?.kind === 'node_selection') {
    return {
      kind: 'node_selection',
      query: interruption.query,
      reason: interruption.reason,
      candidates: interruption.candidates || []
    }
  }
  return normalizeInterruption(interruption)
}

function approvalSummary(interruption) {
  if (interruption?.kind === 'node_selection') {
    return '找到了多个同名或相似节点，请选择要操作的目标节点。'
  }
  const approval = normalizeInterruption(interruption)
  const names = approval.actionRequests.map((item) => item.name).filter(Boolean)
  if (names.includes('canvas_apply_and_generate')) {
    return '角色草稿和图片生成任务已经准备好，等待你的确认后执行。'
  }
  return '画布变更草稿已经准备好，等待你的确认后应用。'
}

function compactResult(result) {
  const text = JSON.stringify(result)
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : result
}

function abortable(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(abortReason(signal)), {
        once: true
      })
    })
  ])
}

function abortReason(signal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
}
