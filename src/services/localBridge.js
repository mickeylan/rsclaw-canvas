import { desktopErrorMessage } from '../domain/desktopError'
import {
  builtinProviderDefinition,
  ensureBuiltinProviderProfiles,
  withBuiltinProviderFields
} from '../../electron/builtin-providers.mjs'

const PROJECTS_KEY = 'lumx.desktop.preview.projects'
const PROJECT_TRASH_KEY = 'lumx.desktop.preview.projectTrash'
const PROVIDERS_KEY = 'lumx.desktop.preview.providers'
const TASKS_KEY = 'lumx.desktop.preview.tasks'
const SKILLS_KEY = 'lumx.desktop.preview.skills'
const ASSISTANT_KEY = 'lumx.desktop.preview.assistant'

export function isDesktopRuntime() {
  return isElectronRuntime()
}

function isElectronRuntime() {
  return typeof window !== 'undefined' && Boolean(window.lumx)
}

async function invoke(command, args = {}) {
  if (isElectronRuntime()) {
    try {
      return await window.lumx.invoke(command, args)
    } catch (error) {
      throw new Error(desktopErrorMessage(error), { cause: error })
    }
  }
  throw new Error('该功能仅在 Electron 桌面端可用')
}

function open(options) {
  return invoke('dialog_open', { options })
}

function save(options) {
  return invoke('dialog_save', { options })
}

function uid(prefix) {
  const value =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}_${value}`
}

function now() {
  return new Date().toISOString()
}

function readPreview(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}

function writePreview(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function previewProject(name = '未命名项目') {
  const timestamp = now()
  return {
    id: uid('project'),
    name,
    canvasJson: JSON.stringify({ nodes: [], edges: [] }),
    viewportJson: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export async function listProjects() {
  if (isDesktopRuntime()) return invoke('list_projects')
  return readPreview(PROJECTS_KEY).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function createProject(name) {
  if (isDesktopRuntime()) return invoke('create_project', { name })
  const projects = readPreview(PROJECTS_KEY)
  const project = previewProject(name)
  writePreview(PROJECTS_KEY, [project, ...projects])
  return project
}

export async function getProject(id) {
  if (isDesktopRuntime()) return invoke('get_project', { id })
  const project = readPreview(PROJECTS_KEY).find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  return project
}

export async function renameProject(id, name) {
  if (isDesktopRuntime()) return invoke('rename_project', { id, name })
  const projects = readPreview(PROJECTS_KEY)
  const project = projects.find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  project.name = name
  project.updatedAt = now()
  project.version += 1
  writePreview(PROJECTS_KEY, projects)
  return project
}

export async function duplicateProject(id) {
  if (isDesktopRuntime()) return invoke('duplicate_project', { id })
  const source = await getProject(id)
  const project = {
    ...source,
    id: uid('project'),
    name: `${source.name} 副本`,
    version: 1,
    createdAt: now(),
    updatedAt: now()
  }
  writePreview(PROJECTS_KEY, [project, ...readPreview(PROJECTS_KEY)])
  return project
}

export async function deleteProject(id) {
  if (isDesktopRuntime()) return invoke('delete_project', { id })
  const projects = readPreview(PROJECTS_KEY)
  const project = projects.find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  writePreview(
    PROJECTS_KEY,
    projects.filter((item) => item.id !== id)
  )
  writePreview(PROJECT_TRASH_KEY, [
    { ...project, updatedAt: now() },
    ...readPreview(PROJECT_TRASH_KEY).filter((item) => item.id !== id)
  ])
}

export async function listDeletedProjects() {
  if (isDesktopRuntime()) return invoke('list_deleted_projects')
  return readPreview(PROJECT_TRASH_KEY)
}

export async function restoreProject(id) {
  if (isDesktopRuntime()) return invoke('restore_project', { id })
  const deleted = readPreview(PROJECT_TRASH_KEY)
  const project = deleted.find((item) => item.id === id)
  if (!project) throw new Error('回收站中没有该项目')
  const restored = { ...project, version: project.version + 1, updatedAt: now() }
  writePreview(
    PROJECT_TRASH_KEY,
    deleted.filter((item) => item.id !== id)
  )
  writePreview(PROJECTS_KEY, [restored, ...readPreview(PROJECTS_KEY)])
  return restored
}

export async function listProjectBackups(projectId) {
  if (isDesktopRuntime()) return invoke('list_project_backups', { projectId })
  return []
}

export async function restoreProjectBackup(projectId, fileName) {
  if (isDesktopRuntime()) return invoke('restore_project_backup', { projectId, fileName })
  throw new Error('自动备份恢复需要在桌面应用中使用')
}

export async function chooseAndExportProject(id, name) {
  if (!isDesktopRuntime()) {
    throw new Error('项目导出需要在桌面应用中使用')
  }
  const safeName =
    String(name || 'LumxAI 项目')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[.\s]+$/g, '')
      .slice(0, 80) || 'LumxAI 项目'
  const destinationPath = await save({
    defaultPath: `${safeName}.lumx`,
    filters: [{ name: 'LumxAI 项目包', extensions: ['lumx'] }]
  })
  if (!destinationPath) return null
  return invoke('export_project', { id, destinationPath })
}

export async function chooseAndImportProject() {
  if (!isDesktopRuntime()) {
    throw new Error('项目导入需要在桌面应用中使用')
  }
  const sourcePath = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'LumxAI 项目包', extensions: ['lumx'] }]
  })
  if (!sourcePath) return null
  return invoke('import_project', { sourcePath })
}

export async function saveCanvas(id, canvasJson, viewportJson, expectedVersion) {
  if (isDesktopRuntime()) {
    return invoke('save_canvas', { id, canvasJson, viewportJson, expectedVersion })
  }
  const projects = readPreview(PROJECTS_KEY)
  const project = projects.find((item) => item.id === id)
  if (!project) throw new Error('项目不存在')
  project.canvasJson = canvasJson
  project.viewportJson = viewportJson
  project.version += 1
  project.updatedAt = now()
  writePreview(PROJECTS_KEY, projects)
  return project
}

export async function listProviderProfiles() {
  if (isDesktopRuntime()) return invoke('list_provider_profiles')
  const providers = readPreview(PROVIDERS_KEY)
  const timestamp = now()
  const normalized = ensureBuiltinProviderProfiles(providers, (definition) => ({
    ...definition,
    enabled: true,
    apiKey: '',
    hasApiKey: false,
    models: [],
    createdAt: timestamp,
    updatedAt: timestamp
  })).map((provider) => {
    const apiKey = String(provider.apiKey || '')
    return {
      ...provider,
      apiKey,
      hasApiKey: Boolean(apiKey)
    }
  })
  writePreview(PROVIDERS_KEY, normalized)
  return normalized
}

export async function saveProviderProfile(input) {
  if (isDesktopRuntime()) return invoke('save_provider_profile', { input })
  const providers = readPreview(PROVIDERS_KEY)
  const timestamp = now()
  let id = input.id || uid('provider')
  const existing = providers.find((item) => item.id === id)
  const existingBuiltin = builtinProviderDefinition(existing?.providerType)
  const requestedBuiltin = builtinProviderDefinition(input.providerType)
  if (existing && !existingBuiltin && requestedBuiltin) {
    throw new Error('系统内置供应商类型不可用于自定义供应商')
  }
  if (!existing && requestedBuiltin) {
    if (providers.some((item) => item.providerType === requestedBuiltin.providerType)) {
      throw new Error('该系统内置供应商已存在')
    }
    id = requestedBuiltin.id
  }
  const normalizedInput =
    existingBuiltin || requestedBuiltin
      ? withBuiltinProviderFields(input, existingBuiltin || requestedBuiltin)
      : input
  const next = {
    id,
    name: normalizedInput.name,
    providerType: normalizedInput.providerType,
    baseUrl: normalizedInput.baseUrl,
    enabled: normalizedInput.enabled,
    isBuiltin: Boolean(existingBuiltin || requestedBuiltin),
    apiKey: String(input.apiKey || '').trim(),
    models: (input.models || []).map((model) => ({
      id: model.id || uid('provider_model'),
      modelId: model.modelId,
      displayName: model.displayName,
      modelType: model.modelType,
      sizeSpecs: Array.isArray(model.sizeSpecs)
        ? model.sizeSpecs.map((spec) => ({
            id: spec.id || uid('size_spec'),
            ratio: spec.ratio,
            resolution: spec.resolution,
            requestSize: spec.requestSize
          }))
        : []
    })),
    hasApiKey: Boolean(String(input.apiKey || '').trim()),
    createdAt: providers.find((item) => item.id === id)?.createdAt || timestamp,
    updatedAt: timestamp
  }
  const index = providers.findIndex((item) => item.id === id)
  if (index >= 0) providers[index] = next
  else providers.unshift(next)
  writePreview(PROVIDERS_KEY, providers)
  return next
}

export async function deleteProviderProfile(id) {
  if (isDesktopRuntime()) return invoke('delete_provider_profile', { id })
  const providers = readPreview(PROVIDERS_KEY)
  const provider = providers.find((item) => item.id === id)
  if (!provider) throw new Error('供应商不存在')
  if (builtinProviderDefinition(provider.providerType)) {
    throw new Error('系统内置供应商不可删除')
  }
  writePreview(
    PROVIDERS_KEY,
    providers.filter((item) => item.id !== id)
  )
}

export async function testProviderProfile(id) {
  if (isDesktopRuntime()) return invoke('test_provider_profile', { id })
  await new Promise((resolve) => setTimeout(resolve, 350))
  return { ok: true, message: '预览模式连接正常', latencyMs: 0 }
}

export async function openExternalUrl(url) {
  if (isDesktopRuntime()) return invoke('open_external_url', { url })
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) throw new Error('浏览器阻止了新窗口，请允许打开外部链接')
  return true
}

export async function chooseAndImportProviderEnv() {
  if (!isDesktopRuntime()) {
    throw new Error('Web 项目供应商配置导入需要在桌面应用中使用')
  }
  const sourcePath = await open({
    multiple: false,
    directory: false,
    title: '选择原 Web 项目 lumx-go/.env 文件'
  })
  if (!sourcePath) return null
  return invoke('import_provider_profiles_from_env', { sourcePath })
}

export async function listAssets(projectId) {
  if (isDesktopRuntime()) return invoke('list_assets', { projectId })
  return []
}

export async function chooseAndImportAsset(projectId, kind) {
  if (!isDesktopRuntime()) {
    throw new Error('本地文件导入需要在桌面应用中使用')
  }
  const selected = await open({
    multiple: false,
    directory: false,
    filters: assetFilters(kind)
  })
  if (!selected) return null
  return invoke('import_asset', { projectId, sourcePath: selected, kind })
}

export async function chooseAndExportAsset(asset) {
  if (!isDesktopRuntime()) {
    throw new Error('素材导出需要在桌面应用中使用')
  }
  const safeName =
    String(asset?.fileName || 'LumxAI-素材')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[.\s]+$/g, '')
      .slice(0, 120) || 'LumxAI-素材'
  const extension = safeName.includes('.')
    ? safeName
        .split('.')
        .pop()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    : ''
  const options = { defaultPath: safeName }
  if (extension) {
    options.filters = [{ name: '素材文件', extensions: [extension] }]
  }
  const destinationPath = await save(options)
  if (!destinationPath) return null
  return invoke('export_asset', { assetId: asset.id, destinationPath })
}

export async function copyImageToClipboard(asset) {
  if (!isDesktopRuntime()) {
    throw new Error('复制图片需要在桌面应用中使用')
  }
  if (!asset?.absolutePath || asset.kind !== 'image') {
    throw new Error('本地图片不存在')
  }
  return invoke('copy_image_to_clipboard', { sourcePath: asset.absolutePath })
}

export function localAssetUrl(asset) {
  if (!asset?.absolutePath) return ''
  if (isElectronRuntime()) {
    return `lumx-asset://local/${encodeURIComponent(asset.absolutePath)}`
  }
  return ''
}

export async function listTasks(projectId) {
  if (isDesktopRuntime()) return invoke('list_tasks', { projectId })
  return readPreview(TASKS_KEY)
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function enqueueTask({ projectId, nodeId, providerId, taskType, requestJson }) {
  if (isDesktopRuntime()) {
    return invoke('enqueue_task', { projectId, nodeId, providerId, taskType, requestJson })
  }
  const tasks = readPreview(TASKS_KEY)
  const timestamp = now()
  const task = {
    id: uid('task'),
    projectId,
    nodeId: nodeId || null,
    providerId,
    taskType,
    providerTaskId: '',
    status: 'queued',
    progress: 0,
    requestJson,
    resultJson: '{}',
    nextPollAt: null,
    errorMessage: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
  writePreview(TASKS_KEY, [task, ...tasks])
  return task
}

export async function cancelTask(id) {
  if (isDesktopRuntime()) return invoke('cancel_task', { id })
  return updatePreviewTask(id, (task) => ({
    ...task,
    status: 'canceled',
    nextPollAt: null,
    updatedAt: now()
  }))
}

export async function retryTask(id) {
  if (isDesktopRuntime()) return invoke('retry_task', { id })
  return updatePreviewTask(id, (task) => ({
    ...task,
    status: 'queued',
    providerTaskId: '',
    progress: 0,
    resultJson: '{}',
    nextPollAt: null,
    errorMessage: '',
    updatedAt: now()
  }))
}

export async function listCanvasSkills() {
  if (isDesktopRuntime()) return invoke('list_canvas_skills')
  const systemSkills = [
    {
      id: 'skill_builtin_character_sheet',
      name: '人物角色设定图',
      description:
        '用于制作单一角色的标准设定图或角色三视图，在纯净背景中同时呈现正面半身头像及正面、侧面、背面全身视图，并保持身份、服装和材质一致。仅在用户明确要求角色设定图、三视图、正侧背或建模参考时使用；普通单张人像、单姿势插画或剧情分镜不要使用。',
      enabled: true,
      sortOrder: 10,
      kind: 'system',
      version: 3,
      capabilities: {
        canViewContent: false,
        canEdit: false,
        canDelete: false,
        canToggle: false
      }
    },
    {
      id: 'skill_builtin_action_storyboard',
      name: '动作分镜图',
      description:
        '用于制作国风玄幻或武侠打斗的16:9九宫格动作预演分镜，连续展示对峙、攻防、闪避、反击与收束，并用彩色箭头标注攻击、移动和碰撞方向。仅在用户要求动作分镜、打斗拆解、武术编排或战斗预演时使用；普通剧情分镜、现代动作题材或精修海报不要使用。',
      enabled: true,
      sortOrder: 20,
      kind: 'system',
      version: 3,
      capabilities: {
        canViewContent: false,
        canEdit: false,
        canDelete: false,
        canToggle: false
      }
    },
    {
      id: 'skill_builtin_storyboard',
      name: '九宫格分镜剧情图',
      description:
        '用于把剧情、脚本或故事梗概拆成16:9九宫格叙事分镜，强调镜头景别、运镜、对话或音效注释、叙事节奏与镜头连续性。仅在用户要求剧情分镜、故事板、镜头脚本或九宫格叙事图时使用；以招式路线和攻防动作为核心的打斗预演应使用“动作分镜图”。',
      enabled: true,
      sortOrder: 30,
      kind: 'system',
      version: 3,
      capabilities: {
        canViewContent: false,
        canEdit: false,
        canDelete: false,
        canToggle: false
      }
    }
  ]
  const customSkills = readPreview(SKILLS_KEY)
    .filter((item) => !String(item?.id || '').startsWith('skill_builtin_'))
    .map((item) => {
      const summary = { ...item }
      delete summary.promptTemplate
      return {
        ...summary,
        kind: 'custom',
        capabilities: {
          canViewContent: true,
          canEdit: true,
          canDelete: true,
          canToggle: true
        }
      }
    })
  return [...systemSkills, ...customSkills].sort(
    (left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
  )
}

export async function getCustomSkillDetail(id) {
  if (isDesktopRuntime()) return invoke('get_custom_skill_detail', { id })
  const item = readPreview(SKILLS_KEY).find((skill) => skill.id === id)
  if (!item || String(id || '').startsWith('skill_builtin_')) {
    throw new Error('自定义 Skill 不存在')
  }
  return { ...item, kind: 'custom' }
}

export async function saveCustomSkill(input) {
  if (isDesktopRuntime()) return invoke('save_custom_skill', { input })
  if (
    String(input?.id || '')
      .trim()
      .startsWith('skill_builtin_')
  ) {
    throw new Error('系统 Skill 不可修改')
  }
  const items = readPreview(SKILLS_KEY)
  const timestamp = now()
  const saved = {
    ...input,
    id: input.id || uid('skill'),
    kind: 'custom',
    revision: Number(input.revision || 0) + 1,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp
  }
  const index = items.findIndex((item) => item.id === saved.id)
  if (index >= 0) items[index] = saved
  else items.push(saved)
  writePreview(SKILLS_KEY, items)
  return saved
}

export async function deleteCustomSkill(id) {
  if (isDesktopRuntime()) return invoke('delete_custom_skill', { id })
  if (
    String(id || '')
      .trim()
      .startsWith('skill_builtin_')
  )
    throw new Error('系统 Skill 不可删除')
  writePreview(
    SKILLS_KEY,
    readPreview(SKILLS_KEY).filter((item) => item.id !== id)
  )
}

export async function getRuntimeCapabilities() {
  if (isDesktopRuntime()) return invoke('get_runtime_capabilities')
  return { systemSkillDeveloperMode: false }
}

export async function getSystemSkillDeveloperDetail(id) {
  if (!isDesktopRuntime()) throw new Error('系统 Skill 开发模式仅在桌面开发构建中可用')
  return invoke('dev_get_system_skill_detail', { id })
}

export async function saveSystemSkillDeveloperDetail(id, input) {
  if (!isDesktopRuntime()) throw new Error('系统 Skill 开发模式仅在桌面开发构建中可用')
  return invoke('dev_save_system_skill', { id, input })
}

export async function listAssistantMessages(projectId) {
  if (isDesktopRuntime()) return invoke('list_assistant_messages', { projectId })
  return readPreview(ASSISTANT_KEY).filter((item) => item.projectId === projectId)
}

export async function clearAssistantMessages(projectId) {
  if (isDesktopRuntime()) return invoke('clear_assistant_messages', { projectId })
  writePreview(
    ASSISTANT_KEY,
    readPreview(ASSISTANT_KEY).filter((item) => item.projectId !== projectId)
  )
}

export async function cancelAssistantMessage(requestId) {
  if (isDesktopRuntime()) return invoke('cancel_assistant_message', { requestId })
}

export async function cancelAssistantRun(runId) {
  if (isDesktopRuntime()) return invoke('cancel_assistant_message', { runId })
}

export async function sendAssistantMessage({
  projectId,
  providerId,
  model,
  content,
  requestId,
  canvasContextJson
}) {
  if (isDesktopRuntime()) {
    return invoke('send_assistant_message', {
      projectId,
      providerId,
      model,
      content,
      requestId,
      canvasContextJson
    })
  }
  const messages = readPreview(ASSISTANT_KEY)
  const user = {
    id: uid('message'),
    projectId,
    role: 'user',
    content,
    actionsJson: '[]',
    createdAt: now()
  }
  const assistant = {
    id: uid('message'),
    projectId,
    role: 'assistant',
    content: '浏览器预览模式不会调用真实 AI，请在桌面端使用本地助手。',
    actionsJson: '[]',
    createdAt: now()
  }
  writePreview(ASSISTANT_KEY, [...messages, user, assistant])
  return { message: assistant, actions: [] }
}

export async function resumeAgentRun(runId, decisions) {
  if (!isElectronRuntime()) throw new Error('Deep Agents 审批仅在 Electron 桌面端可用')
  return invoke('resume_agent_run', { runId, decisions })
}

export async function getPendingAgentApproval(projectId) {
  if (!isElectronRuntime()) return null
  return invoke('get_pending_agent_approval', { projectId })
}

export async function getAgentDraft(draftId) {
  if (!isElectronRuntime()) return null
  return invoke('get_agent_draft', { draftId })
}

export function onAgentEvent(listener) {
  if (!isElectronRuntime()) return () => {}
  return window.lumx.onAgentEvent(listener)
}

export async function onDesktopCloseRequested(listener) {
  if (!isElectronRuntime()) return () => {}
  return window.lumx.onCloseRequested(() => listener({ preventDefault() {} }))
}

export async function closeDesktopWindow() {
  if (!isElectronRuntime()) return
  return window.lumx.closeWindow()
}

function updatePreviewTask(id, transform) {
  const tasks = readPreview(TASKS_KEY)
  const index = tasks.findIndex((item) => item.id === id)
  if (index < 0) throw new Error('任务不存在')
  tasks[index] = transform(tasks[index])
  writePreview(TASKS_KEY, tasks)
  return tasks[index]
}

function assetFilters(kind) {
  if (kind === 'image') {
    return [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  }
  if (kind === 'video') {
    return [{ name: '视频', extensions: ['mp4', 'mov', 'webm', 'mkv'] }]
  }
  if (kind === 'audio') {
    return [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac'] }]
  }
  return [{ name: '所有文件', extensions: ['*'] }]
}
