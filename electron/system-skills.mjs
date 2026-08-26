import { readFileSync, readdirSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const systemSkillDirectory = fileURLToPath(new URL('./system-skills/', import.meta.url))
const systemSkillIdPattern = /^skill_builtin_[a-z0-9_]+$/

function systemSkillFiles() {
  return readdirSync(systemSkillDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
}

function normalizeSystemSkill(input, fileName = '') {
  const id = String(input?.id || '').trim()
  const name = String(input?.name || '').trim()
  const description = String(input?.description || '').trim()
  const promptTemplate = String(input?.promptTemplate || '').trim()
  const version = Number(input?.version || 1)
  const sortOrder = Number(input?.sortOrder || 0)
  if (!systemSkillIdPattern.test(id)) throw new Error(`系统 Skill ID 不合法：${id || fileName}`)
  if (!name || name.length > 80) throw new Error(`系统 Skill 名称不合法：${id}`)
  if (description.length > 200) throw new Error(`系统 Skill 说明过长：${id}`)
  if (!promptTemplate || promptTemplate.length > 20000) {
    throw new Error(`系统 Skill 提示规则不合法：${id}`)
  }
  if (!Number.isInteger(version) || version < 1) throw new Error(`系统 Skill 版本不合法：${id}`)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    throw new Error(`系统 Skill 排序不合法：${id}`)
  }
  return {
    id,
    version,
    name,
    description,
    promptTemplate,
    enabled: true,
    sortOrder,
    kind: 'system',
    sourceFile: fileName
  }
}

export function loadSystemSkills() {
  const ids = new Set()
  const skills = systemSkillFiles().map((fileName) => {
    const source = JSON.parse(readFileSync(path.join(systemSkillDirectory, fileName), 'utf8'))
    const skill = normalizeSystemSkill(source, fileName)
    if (ids.has(skill.id)) throw new Error(`系统 Skill ID 重复：${skill.id}`)
    ids.add(skill.id)
    return skill
  })
  return skills.sort(
    (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)
  )
}

export function getSystemSkill(id) {
  return loadSystemSkills().find((skill) => skill.id === id) || null
}

export function systemSkillSummary(skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: true,
    sortOrder: skill.sortOrder,
    kind: 'system',
    version: skill.version,
    capabilities: {
      canViewContent: false,
      canEdit: false,
      canDelete: false,
      canToggle: false
    }
  }
}

export async function updateSystemSkill(id, input) {
  const current = getSystemSkill(id)
  if (!current) throw new Error('系统 Skill 不存在')
  const next = normalizeSystemSkill(
    {
      id: current.id,
      version: current.version + 1,
      name: input?.name,
      description: input?.description,
      promptTemplate: input?.promptTemplate,
      sortOrder: input?.sortOrder
    },
    current.sourceFile
  )
  const targetPath = path.join(systemSkillDirectory, current.sourceFile)
  const temporaryPath = `${targetPath}.${process.pid}.tmp`
  const serialized = `${JSON.stringify(
    {
      id: next.id,
      version: next.version,
      name: next.name,
      description: next.description,
      promptTemplate: next.promptTemplate,
      sortOrder: next.sortOrder
    },
    null,
    2
  )}\n`
  await writeFile(temporaryPath, serialized, 'utf8')
  await rename(temporaryPath, targetPath)
  return getSystemSkill(id)
}
