import { createHash } from 'node:crypto'
import { ToolMessage } from '@langchain/core/messages'
import { createMiddleware } from 'langchain'

const SKILL_ROOT = '/skills/'
const SKILL_FILE_NAME = 'SKILL.md'
const OPERATIONAL_EXCLUSIONS =
  '仅当用户目标与此能力直接匹配时使用；画布移动、删除、改名、连线、查询状态或原样重新生成已有节点时不要使用。'

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, '')
    .replace(/[“”"'「」『』【】()[\]，,。.!！:：]/g, '')
}

function yamlScalar(value) {
  return JSON.stringify(String(value ?? ''))
}

function stableHash(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function skillSlug(skill) {
  const id = String(skill?.id || '')
    .trim()
    .toLocaleLowerCase()
  const base =
    id
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'custom-skill'
  return `lumx-${base}-${stableHash(id).slice(0, 8)}`
}

export function skillActivationDescription(skill) {
  const name = String(skill?.name || '').trim()
  const description = String(skill?.description || '').trim()
  return `${name}${description ? `：${description}` : ''}。${OPERATIONAL_EXCLUSIONS}`.slice(0, 1024)
}

export function buildSkillMarkdown(skill) {
  const slug = skillSlug(skill)
  const revision = Number(skill?.revision || skill?.version || 1)
  const body = String(skill?.promptTemplate || '').trim()
  if (!String(skill?.id || '').trim()) throw new Error('Skill ID 不能为空')
  if (!String(skill?.name || '').trim()) throw new Error('Skill 名称不能为空')
  if (!body) throw new Error(`Skill“${skill.name}”缺少提示规则`)
  if (body.length > 20000) throw new Error(`Skill“${skill.name}”提示规则过长`)
  return `---
name: ${yamlScalar(slug)}
description: ${yamlScalar(skillActivationDescription(skill))}
metadata:
  lumx-id: ${yamlScalar(skill.id)}
  lumx-display-name: ${yamlScalar(skill.name)}
  lumx-kind: ${yamlScalar(skill.kind === 'system' ? 'system' : 'custom')}
  lumx-revision: ${yamlScalar(revision)}
---

# ${String(skill.name)
    .replace(/[\r\n]+/g, ' ')
    .trim()}

${body}

## 权限边界

本 Skill 只能影响创意语义，例如提示词、风格、构图和内容拆分。不得决定画布节点 ID、坐标、供应商、模型、尺寸 ID、文件路径、画布写入、任务提交或用户审批。
`
}

export function buildNativeSkillBundle(skills, timestamp = new Date().toISOString()) {
  const files = {}
  const entries = []
  const seenPaths = new Set()
  for (const source of Array.isArray(skills) ? skills : []) {
    if (source?.enabled === false) continue
    const markdown = buildSkillMarkdown(source)
    const slug = skillSlug(source)
    const path = `${SKILL_ROOT}${slug}/${SKILL_FILE_NAME}`
    if (seenPaths.has(path)) throw new Error(`Skill 虚拟路径重复：${path}`)
    seenPaths.add(path)
    const contentHash = stableHash(markdown)
    const skill = {
      id: String(source.id),
      name: String(source.name),
      description: String(source.description || ''),
      promptTemplate: String(source.promptTemplate || ''),
      enabled: true,
      sortOrder: Number(source.sortOrder || 0),
      revision: Number(source.revision || source.version || 1),
      kind: source.kind === 'system' ? 'system' : 'custom',
      slug,
      path,
      contentHash
    }
    entries.push(skill)
    files[path] = {
      content: markdown,
      mimeType: 'text/markdown',
      created_at: timestamp,
      modified_at: timestamp
    }
  }
  entries.sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
  )
  return {
    sources: [SKILL_ROOT],
    files,
    skills: entries
  }
}

export function explicitlyDeniedSkillIds(content, skills) {
  const text = normalizeText(content)
  const denied = new Set()
  if (!text) return denied
  const denyTerms = ['不要使用', '禁止使用', '禁止调用', '不要调用', '不要用', '不用', '别用']
  for (const skill of Array.isArray(skills) ? skills : []) {
    const name = normalizeText(skill?.name)
    if (!name) continue
    if (denyTerms.some((term) => text.includes(`${term}${name}`))) denied.add(String(skill.id))
  }
  return denied
}

function readFilePath(toolCall) {
  const args = toolCall?.args || {}
  return String(args.file_path || args.filePath || args.path || '').trim()
}

function rejectedToolMessage(toolCall, content) {
  return new ToolMessage({
    content,
    tool_call_id: toolCall?.id || 'skill_read_rejected'
  })
}

export function createSingleSkillActivationMiddleware({
  skills,
  deniedSkillIds = new Set(),
  onActivated = async () => {},
  onRejected = async () => {}
}) {
  const byPath = new Map((Array.isArray(skills) ? skills : []).map((skill) => [skill.path, skill]))
  const skillDirectories = (Array.isArray(skills) ? skills : []).map((skill) => ({
    skill,
    directory: skill.path.slice(0, -SKILL_FILE_NAME.length)
  }))
  let activeSkill = null
  return createMiddleware({
    name: 'LumxSingleSkillActivation',
    async wrapToolCall(request, handler) {
      const toolName = request?.toolCall?.name || request?.tool?.name
      if (toolName !== 'read_file') return handler(request)
      const path = readFilePath(request.toolCall)
      const primarySkill = byPath.get(path)
      const skill =
        primarySkill ||
        skillDirectories.find((entry) => path.startsWith(entry.directory))?.skill ||
        null
      if (!skill) return handler(request)
      if (deniedSkillIds.has(skill.id)) {
        await onRejected(skill, 'explicitly_denied')
        return rejectedToolMessage(
          request.toolCall,
          `用户已明确要求不使用 Skill“${skill.name}”，请在不读取和不应用该 Skill 的情况下继续。`
        )
      }
      if (activeSkill && activeSkill.path !== path) {
        const insideActiveSkill = path.startsWith(
          activeSkill.path.slice(0, -SKILL_FILE_NAME.length)
        )
        if (insideActiveSkill) return handler(request)
        await onRejected(skill, 'second_primary_skill')
        return rejectedToolMessage(
          request.toolCall,
          `本轮已经激活 Skill“${activeSkill.name}”，每次请求最多只能应用一个主 Skill。请继续使用已激活的 Skill。`
        )
      }
      if (!primarySkill && !activeSkill) {
        await onRejected(skill, 'instructions_not_activated')
        return rejectedToolMessage(
          request.toolCall,
          `请先读取 ${skill.path} 激活 Skill，再读取它的参考文件。`
        )
      }
      const result = await handler(request)
      if (primarySkill && !activeSkill) {
        activeSkill = skill
        await onActivated(skill)
      }
      return result
    }
  })
}

export function parseSkillSemanticDecision(content) {
  const text = String(content || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const intent = ['role_design', 'visual_design', 'general'].includes(parsed?.intent)
    ? parsed.intent
    : 'general'
  const action = ['create', 'revise', 'analyze', 'general'].includes(parsed?.action)
    ? parsed.action
    : 'general'
  return {
    intent,
    action,
    textOnly: Boolean(parsed?.textOnly)
  }
}

export function nativeSkillBundleSnapshot(bundle) {
  return {
    sources: Array.isArray(bundle?.sources) ? bundle.sources : [SKILL_ROOT],
    skills: (Array.isArray(bundle?.skills) ? bundle.skills : []).map((skill) => ({ ...skill })),
    files: Object.fromEntries(
      Object.entries(bundle?.files || {}).map(([path, file]) => [
        path,
        {
          content: String(file?.content || ''),
          mimeType: 'text/markdown',
          created_at: String(file?.created_at || new Date().toISOString()),
          modified_at: String(file?.modified_at || file?.created_at || new Date().toISOString())
        }
      ])
    )
  }
}
