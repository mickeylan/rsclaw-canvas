import { z } from 'zod'

const creativeItemSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(2000),
    positivePrompt: z.string().trim().min(20).max(20000),
    targetNodeId: z.string().trim().min(1).optional(),
    updateMode: z.enum(['update', 'variant']).optional().default('update')
  })
  .strip()
  .superRefine((item, context) => {
    if (!isChinesePrompt(item.positivePrompt, { minimumHanCharacters: 10 })) {
      context.addIssue({
        code: 'custom',
        path: ['positivePrompt'],
        message: 'positivePrompt 必须以中文为主，英文仅可用于 3D、PBR 等必要术语'
      })
    }
  })

const creativeSpecSchema = z
  .object({
    type: z.enum(['role_design', 'visual_design']),
    summary: z.string().trim().min(1).max(2000),
    items: z.array(creativeItemSchema).min(1).max(12)
  })
  .strip()

export function parseCreativeSpec(
  content,
  { action = 'create', expectedCount = null, expectedType = null, allowedNodeIds = [] } = {}
) {
  const parsed = creativeSpecSchema.parse(parseJsonObject(content))
  if (expectedType && parsed.type !== expectedType) {
    throw new Error(`创意类型应为 ${expectedType}，实际返回 ${parsed.type}`)
  }
  if (Number.isInteger(expectedCount) && parsed.items.length !== expectedCount) {
    throw new Error(`角色数量应为 ${expectedCount}，实际返回 ${parsed.items.length}`)
  }
  if (action === 'revise') {
    const allowed = new Set(allowedNodeIds)
    for (const item of parsed.items) {
      if (!item.targetNodeId) throw new Error(`“${item.name}”缺少 targetNodeId`)
      if (!allowed.has(item.targetNodeId)) {
        throw new Error(`目标节点 ${item.targetNodeId} 不存在或不是图片节点`)
      }
    }
  }
  return parsed
}

export function normalizeCreativeContext(canvasContextJson) {
  const source = parseJson(canvasContextJson, {})
  const availableImageModels = Array.isArray(source.availableImageModels)
    ? source.availableImageModels.slice(0, 6).map(normalizeModel)
    : []
  const defaultImageModel = source.defaultImageModel
    ? normalizeModel(source.defaultImageModel)
    : null
  const nodes = Array.isArray(source.nodes)
    ? source.nodes
        .filter((node) => node?.kind === 'image')
        .slice(-24)
        .map((node) => ({
          id: String(node.id || ''),
          name: String(node.name || node.id || '').slice(0, 100),
          prompt: String(node.prompt || '').slice(0, 4000),
          providerId: String(node.providerId || ''),
          model: String(node.model || ''),
          sizeSpecId: String(node.sizeSpecId || ''),
          ratio: String(node.ratio || ''),
          resolution: String(node.resolution || ''),
          position: {
            x: finiteNumber(node.position?.x),
            y: finiteNumber(node.position?.y)
          }
        }))
        .filter((node) => node.id)
    : []
  return { defaultImageModel, availableImageModels, nodes }
}

export function compactCreativeContext(context) {
  return {
    existingCharacters: context.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      prompt: node.prompt.slice(0, 1200)
    }))
  }
}

export function resolveRevisionTargetId(content, nodes) {
  const text = String(content || '').toLocaleLowerCase()
  const mentioned = (nodes || [])
    .filter((node) => {
      const name = String(node.name || '')
        .trim()
        .toLocaleLowerCase()
      return name && text.includes(`@${name}`)
    })
    .sort((left, right) => String(right.name || '').length - String(left.name || '').length)
  if (mentioned.length) {
    const longestLength = String(mentioned[0].name || '').length
    const longestMatches = mentioned.filter(
      (node) => String(node.name || '').length === longestLength
    )
    if (longestMatches.length === 1) return longestMatches[0].id
  }
  const matches = (nodes || []).filter((node) => {
    const id = String(node.id || '').toLocaleLowerCase()
    const name = String(node.name || '')
      .trim()
      .toLocaleLowerCase()
    return (id && text.includes(id)) || (name && text.includes(name))
  })
  const uniqueIds = [...new Set(matches.map((node) => node.id))]
  if (uniqueIds.length === 1) return uniqueIds[0]
  return nodes?.length === 1 ? nodes[0].id : null
}

export function expectedCreativeItemCount(content) {
  const text = String(content || '')
  const arabic = text.match(/(?:设计|创建|生成|制作|画|来|要)?\s*(\d{1,2})\s*(?:个|位|名|套|张)/)
  if (arabic) return clampCount(Number(arabic[1]))
  const chinese = [
    ['十二', 12],
    ['十一', 11],
    ['十', 10],
    ['九', 9],
    ['八', 8],
    ['七', 7],
    ['六', 6],
    ['五', 5],
    ['四', 4],
    ['三', 3],
    ['两', 2],
    ['二', 2],
    ['一', 1]
  ]
  for (const [token, count] of chinese) {
    if (new RegExp(`${token}\\s*(?:个|位|名|套|张)`).test(text)) return count
  }
  return null
}

export function inferRequestedRatio(content, selectedSkill) {
  const text = [content, selectedSkill?.promptTemplate].filter(Boolean).join('\n')
  const match = text.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/)
  return match ? `${match[1]}:${match[2]}` : '16:9'
}

export function selectImageGenerationSettings(context, requestedRatio, targetNode = null) {
  if (targetNode?.providerId && targetNode?.model) {
    return {
      providerId: targetNode.providerId,
      model: targetNode.model,
      sizeSpecId: targetNode.sizeSpecId,
      ratio: targetNode.ratio || requestedRatio,
      resolution: targetNode.resolution,
      requestSize: ''
    }
  }
  const preferred = context.defaultImageModel
  const candidates = [preferred, ...context.availableImageModels].filter(Boolean)
  const model =
    candidates.find(
      (item) => item.providerId === preferred?.providerId && item.modelId === preferred?.modelId
    ) || candidates[0]
  if (!model) {
    return {
      providerId: '',
      model: '',
      sizeSpecId: '',
      ratio: requestedRatio,
      resolution: '',
      requestSize: ''
    }
  }
  const preferredResolution = model.defaultResolution || preferred?.defaultResolution || ''
  const sizeSpec =
    model.sizeSpecs.find(
      (spec) => spec.ratio === requestedRatio && spec.resolution === preferredResolution
    ) ||
    model.sizeSpecs.find((spec) => spec.ratio === requestedRatio) ||
    model.sizeSpecs.find((spec) => spec.resolution === preferredResolution) ||
    model.sizeSpecs[0] ||
    {}
  return {
    providerId: model.providerId,
    model: model.modelId,
    sizeSpecId: sizeSpec.id || '',
    ratio: sizeSpec.ratio || requestedRatio,
    resolution: sizeSpec.resolution || preferredResolution,
    requestSize: sizeSpec.requestSize || sizeSpec.ratio || requestedRatio
  }
}

export function buildRoleCanvasOperations(spec, { action, context, requestedRatio = '16:9' }) {
  const positions = nextNodePositions(
    context.nodes,
    spec.items.map(() => ({ ratio: requestedRatio }))
  )
  return spec.items.map((item, index) => {
    const target = item.targetNodeId
      ? context.nodes.find((node) => node.id === item.targetNodeId)
      : null
    const prompt = item.positivePrompt
    if (action === 'revise' && item.updateMode === 'update' && target) {
      const settings = selectImageGenerationSettings(context, requestedRatio, target)
      return {
        op: 'updateNode',
        nodeRef: target.id,
        updates: {
          name: item.name || target.name,
          prompt,
          ...settings
        }
      }
    }
    const settings = selectImageGenerationSettings(context, requestedRatio, target)
    return {
      op: 'createNode',
      tempId: `creative_${index + 1}`,
      kind: 'image',
      ...positions[index],
      name: item.name,
      prompt,
      ...settings
    }
  })
}

export function reflowCreateNodeOperations(operations, existingNodes) {
  const creates = operations.filter((operation) => operation.op === 'createNode')
  const positions = nextNodePositions(existingNodes, creates)
  let index = 0
  return operations.map((operation) => {
    if (operation.op !== 'createNode') return operation
    const position = positions[index]
    index += 1
    return { ...operation, ...position }
  })
}

export function formatCreativeSpecText(spec, action = 'create') {
  const subject = spec.type === 'visual_design' ? '视觉' : '角色'
  const heading = action === 'revise' ? `${subject}修改方案已完成` : `${subject}设计方案已完成`
  const details = spec.items
    .map(
      (item, index) =>
        `${index + 1}. ${item.name}：${item.description}${
          action === 'revise' && item.updateMode === 'variant' ? '（保留原角色并创建变体）' : ''
        }`
    )
    .join('\n')
  return `${heading}。\n\n${spec.summary}\n\n${details}`
}

export function draftPlanFromCreativeSpec(spec, action) {
  const subject = spec.type === 'visual_design' ? '视觉节点' : '角色'
  return {
    title: action === 'revise' ? `修改${subject}` : `创建${subject}`,
    summary: spec.summary,
    steps: spec.items.map((item) =>
      action === 'revise'
        ? `${item.updateMode === 'variant' ? '创建变体' : `更新${subject}`}：${item.name}`
        : `创建${subject}：${item.name}`
    )
  }
}

function parseJsonObject(content) {
  const text = String(content || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('专业 Agent 未返回 JSON 对象')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    throw new Error(`专业 Agent JSON 无法解析：${error.message}`, { cause: error })
  }
}

function parseJson(value, fallback) {
  if (!value) return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeModel(model) {
  return {
    providerId: String(model?.providerId || ''),
    modelId: String(model?.modelId || ''),
    displayName: String(model?.displayName || ''),
    defaultResolution: String(model?.defaultResolution || ''),
    sizeSpecs: Array.isArray(model?.sizeSpecs)
      ? model.sizeSpecs.slice(0, 16).map((spec) => ({
          id: String(spec?.id || ''),
          ratio: String(spec?.ratio || ''),
          resolution: String(spec?.resolution || ''),
          requestSize: String(spec?.requestSize || '')
        }))
      : []
  }
}

function nextNodePositions(nodes, createItems) {
  const existing = (Array.isArray(nodes) ? nodes : []).filter((node) => node?.position)
  const items = Array.isArray(createItems) ? createItems : []
  const startX = existing.length
    ? snapToGrid(Math.min(...existing.map((node) => finiteNumber(node.position.x))))
    : 0
  let rowY = existing.length
    ? Math.max(
        ...existing.map((node) => finiteNumber(node.position.y) + estimatedCanvasNodeHeight(node))
      ) + CANVAS_NODE_GAP
    : 0
  const positions = []

  for (let index = 0; index < items.length; index += CANVAS_GRID_COLUMNS) {
    const row = items.slice(index, index + CANVAS_GRID_COLUMNS)
    row.forEach((_item, column) => {
      positions.push({
        x: startX + column * CANVAS_COLUMN_STEP,
        y: roundCanvasCoordinate(rowY)
      })
    })
    const rowHeight = Math.max(...row.map(estimatedCanvasNodeHeight), DEFAULT_NODE_HEIGHT)
    rowY += rowHeight + CANVAS_NODE_GAP
  }
  return positions
}

const CANVAS_GRID_COLUMNS = 3
const CANVAS_NODE_WIDTH = 320
const CANVAS_NODE_GAP = 2
const CANVAS_COLUMN_STEP = CANVAS_NODE_WIDTH + CANVAS_NODE_GAP
const CANVAS_TITLE_BLOCK_HEIGHT = 22
const CANVAS_GRID_SIZE = 20
const DEFAULT_NODE_HEIGHT = CANVAS_NODE_WIDTH + CANVAS_TITLE_BLOCK_HEIGHT

function estimatedCanvasNodeHeight(node) {
  const ratio = String(
    node?.ratio || node?.aspectRatio || node?.data?.ratio || node?.data?.aspectRatio || '1:1'
  )
  const match = ratio.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  const width = Number(match?.[1] || 1)
  const height = Number(match?.[2] || 1)
  const previewHeight =
    width > 0 && height > 0 ? (CANVAS_NODE_WIDTH * height) / width : CANVAS_NODE_WIDTH
  return CANVAS_TITLE_BLOCK_HEIGHT + previewHeight
}

function snapToGrid(value) {
  return Math.round(finiteNumber(value) / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE
}

function roundCanvasCoordinate(value) {
  return Number(finiteNumber(value).toFixed(3))
}

function isChinesePrompt(value, { minimumHanCharacters }) {
  const text = String(value || '')
  const hanCharacters = text.match(/\p{Script=Han}/gu)?.length || 0
  const latinCharacters = text.match(/[A-Za-z]/g)?.length || 0
  return hanCharacters >= minimumHanCharacters && hanCharacters >= Math.ceil(latinCharacters * 0.5)
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function clampCount(value) {
  if (!Number.isInteger(value)) return null
  return Math.min(12, Math.max(1, value))
}
