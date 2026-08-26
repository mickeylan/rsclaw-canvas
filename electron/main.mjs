import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  nativeTheme,
  protocol,
  safeStorage,
  shell,
  utilityProcess
} from 'electron'
import { pollProviderTask, startProviderTask } from './provider-media.mjs'
import { isBuiltinProviderOfficialUrl } from './builtin-providers.mjs'
import { readChatResponse } from './model-stream.mjs'
import { UtilityRpc } from './rpc.mjs'
import { createConcurrentTaskPump } from './task-pump.mjs'
import { canEditSystemSkills, isRendererCoreCommand } from './renderer-commands.mjs'
import { getSystemSkill, updateSystemSkill } from './system-skills.mjs'
import { shouldInterceptWindowClose } from './window-close-policy.mjs'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const developmentUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:1420'
const systemSkillDeveloperMode = canEditSystemSkills({ isPackaged: app.isPackaged })
const applicationIconPath = app.isPackaged
  ? path.join(currentDirectory, '..', 'dist', 'app-icon.png')
  : path.join(currentDirectory, '..', 'public', 'app-icon.png')
const windowAppearance = {
  dark: {
    backgroundColor: '#000000'
  },
  light: {
    backgroundColor: '#ffffff'
  }
}
const legacyUserData = path.join(app.getPath('appData'), 'com.rsclaw.canvas')
app.setPath('userData', legacyUserData)
nativeTheme.themeSource = 'dark'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'rsclaw-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

let mainWindow
let coreRpc
let agentRpc
let allowWindowClose = false
let windowCloseGuardEnabled = false
let taskTimer
let taskPump

app.whenReady().then(async () => {
  registerAssetProtocol()
  installApplicationMenu()
  startWorkers()
  registerIpc()
  await coreRpc.request('invoke', { command: 'get_storage_info', args: {} })
  await migrateLegacyProviderApiKeys()
  await agentRpc.request('ping')
  startTaskPump()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  allowWindowClose = true
  clearInterval(taskTimer)
  taskPump?.stop()
  coreRpc?.child?.kill()
  agentRpc?.child?.kill()
})

function startWorkers() {
  const coreChild = utilityProcess.fork(
    path.join(currentDirectory, 'workers', 'core-worker.mjs'),
    [app.getPath('userData')],
    { serviceName: 'rsclaw Core Service', stdio: 'pipe' }
  )
  pipeWorkerErrors(coreChild, 'core')
  coreRpc = new UtilityRpc(coreChild, {
    onEvent: (event) => forwardEvent(event)
  })

  const agentChild = utilityProcess.fork(
    path.join(currentDirectory, 'workers', 'agent-worker.mjs'),
    [],
    { serviceName: 'rsclaw Deep Agent Service', stdio: 'pipe' }
  )
  pipeWorkerErrors(agentChild, 'agent')
  agentRpc = new UtilityRpc(agentChild, {
    onRequest: routeAgentRequest,
    onEvent: async (event) => {
      if (event?.type === 'agent.event' && event.data) {
        await coreRpc.request('agent_event', { event: event.data }).catch((error) => {
          console.error('Could not persist agent event:', error)
        })
      }
      forwardEvent(event)
    }
  })
}

function createWindow() {
  allowWindowClose = false
  windowCloseGuardEnabled = false
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: windowAppearance[nativeTheme.themeSource].backgroundColor,
    title: 'rsclaw-canvas',
    icon: applicationIconPath,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', (event) => {
    if (mainWindow.isDestroyed()) return
    if (
      !shouldInterceptWindowClose({ allowWindowClose, closeGuardEnabled: windowCloseGuardEnabled })
    ) {
      return
    }
    event.preventDefault()
    mainWindow.webContents.send('rsclaw:close-requested')
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`)
  })
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(currentDirectory, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL(developmentUrl)
  }
}

function installApplicationMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        ...(process.platform === 'darwin'
          ? []
          : [{ label: '退出 rsclaw-canvas', accelerator: 'Alt+F4', role: 'quit' }])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '刷新', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制刷新', accelerator: 'Shift+CmdOrCtrl+R', role: 'forceReload' },
        { type: 'separator' },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        ...(!app.isPackaged
          ? [{ label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' }]
          : [])
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        ...(process.platform === 'darwin'
          ? [
              { label: '缩放', role: 'zoom' },
              { type: 'separator' },
              { label: '前置全部窗口', role: 'front' }
            ]
          : [{ label: '关闭', accelerator: 'Alt+F4', role: 'close' }])
      ]
    }
  ]
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { label: '关于 rsclaw-canvas', role: 'about' },
        { type: 'separator' },
        { label: '服务', role: 'services' },
        { type: 'separator' },
        { label: '隐藏 rsclaw-canvas', accelerator: 'Command+H', role: 'hide' },
        { label: '隐藏其他应用', accelerator: 'Command+Alt+H', role: 'hideOthers' },
        { label: '显示全部', role: 'unhide' },
        { type: 'separator' },
        { label: '退出 rsclaw-canvas', accelerator: 'Command+Q', role: 'quit' }
      ]
    })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc() {
  ipcMain.on('rsclaw:set-close-guard', (event, enabled) => {
    if (event.sender !== mainWindow?.webContents) return
    windowCloseGuardEnabled = Boolean(enabled)
  })
  ipcMain.handle('rsclaw:set-appearance', (_event, mode) => {
    applyWindowAppearance(mode)
  })
  ipcMain.handle('rsclaw:close-window', () => {
    allowWindowClose = true
    mainWindow?.close()
  })
  ipcMain.handle('rsclaw:invoke', async (_event, command, args = {}) => {
    if (command === 'dialog_open') return openDialog(args.options || {})
    if (command === 'dialog_save') return saveDialog(args.options || {})
    if (command === 'copy_image_to_clipboard') return copyImageToClipboard(args.sourcePath)
    if (command === 'get_runtime_capabilities') {
      return { systemSkillDeveloperMode }
    }
    if (command === 'dev_get_system_skill_detail') {
      if (!systemSkillDeveloperMode) throw new Error('系统 Skill 开发模式未启用')
      const skill = getSystemSkill(args.id)
      if (!skill) throw new Error('系统 Skill 不存在')
      return skill
    }
    if (command === 'dev_save_system_skill') {
      if (!systemSkillDeveloperMode) throw new Error('系统 Skill 开发模式未启用')
      return updateSystemSkill(args.id, args.input || {})
    }
    if (command === 'send_assistant_message') return agentRpc.request('send', args, 600000)
    if (command === 'resume_agent_run') return agentRpc.request('resume', args, 600000)
    if (command === 'cancel_assistant_message') return agentRpc.request('cancel', args)
    if (command === 'save_provider_profile') {
      return saveProviderWithPlaintextKey(args.input || {})
    }
    if (command === 'test_provider_profile') return testProvider(args.id)
    if (command === 'open_external_url') return openExternalUrl(args.url)
    if (command === 'import_provider_profiles_from_env')
      return importProviderEnvironment(args.sourcePath)
    if (command === 'get_provider_runtime') throw new Error('该命令不能从界面调用')
    if (!isRendererCoreCommand(command)) throw new Error('该命令不能从界面调用')
    return coreRpc.request('invoke', { command, args }, 300000)
  })
}

async function openExternalUrl(value) {
  const url = String(value || '')
  if (!isBuiltinProviderOfficialUrl(url)) throw new Error('不允许打开该外部链接')
  await shell.openExternal(url)
  return true
}

function applyWindowAppearance(mode) {
  const normalizedMode = mode === 'light' ? 'light' : 'dark'
  nativeTheme.themeSource = normalizedMode
  mainWindow?.setBackgroundColor(windowAppearance[normalizedMode].backgroundColor)
  installApplicationMenu()
}

async function routeAgentRequest(method, params) {
  if (method === 'model.chat') return modelChat(params)
  if (method.startsWith('core.')) return coreRpc.request(method.slice(5), params, 300000)
  throw new Error(`Unsupported agent request: ${method}`)
}

async function saveProviderWithPlaintextKey(input) {
  const next = {
    ...input,
    apiKey: String(input.apiKey || '').trim()
  }
  return coreRpc.request('invoke', {
    command: 'save_provider_profile',
    args: { input: next }
  })
}

async function modelChat({ providerId, modelId, messages, tools, temperature, agentContext = {} }) {
  const runtime = await coreRpc.request('provider_runtime', { providerId })
  const apiKey = resolveProviderApiKey(runtime)
  const isOllama = runtime.providerType === 'ollama'
  if (!isOllama && !apiKey) throw new Error('该供应商尚未配置 API Key')
  const endpoint = chatEndpoint(runtime)
  const body = {
    model: modelId,
    messages,
    stream: true
  }
  if (!isOllama) body.stream_options = { include_usage: true }
  if (tools?.length) body.tools = tools
  if (Number.isFinite(temperature)) body.temperature = temperature

  const startedAt = Date.now()
  const callId = `model_call_${randomUUID()}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000)
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`模型请求失败（${response.status}）：${safeRemoteMessage(text)}`)
  }
  try {
    const textDeltas = []
    const result = await readChatResponse(response, {
      isOllama,
      onTextDelta(delta) {
        if (agentContext.streamToUser) textDeltas.push(delta)
      }
    })
    result.usage = { ...result.usage, latencyMs: Date.now() - startedAt }
    if (agentContext.streamToUser && result.toolCalls.length === 0 && result.content) {
      const safeDeltas = coalesceTextDeltas(textDeltas, result.content)
      forwardModelEvent(agentContext, 'model.stream.started', { callId })
      for (const delta of safeDeltas) {
        forwardModelEvent(agentContext, 'model.stream.chunk', { callId, delta })
        await delay(14)
      }
      forwardModelEvent(agentContext, 'model.stream.completed', {
        callId,
        hasToolCalls: false
      })
    }
    return result
  } catch (error) {
    if (agentContext.streamToUser) {
      forwardModelEvent(agentContext, 'model.stream.failed', { callId })
    }
    throw error
  }
}

function coalesceTextDeltas(deltas, fallback) {
  const source = deltas.length ? deltas.join('') : fallback
  if (!source) return []
  const maximumChunks = 90
  const chunkSize = Math.max(1, Math.ceil(source.length / maximumChunks))
  const chunks = []
  for (let index = 0; index < source.length; index += chunkSize) {
    chunks.push(source.slice(index, index + chunkSize))
  }
  return chunks
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function forwardModelEvent(agentContext, type, payload) {
  forwardEvent({
    type: 'agent.event',
    data: {
      runId: agentContext.runId,
      requestId: agentContext.requestId,
      projectId: agentContext.projectId,
      type,
      payload
    }
  })
}

async function testProvider(id) {
  const runtime = await coreRpc.request('provider_runtime', { providerId: id })
  const startedAt = Date.now()
  if (runtime.providerType === 'ollama') {
    const response = await fetch(joinUrl(runtime.baseUrl, '/api/tags'), {
      signal: AbortSignal.timeout(12000)
    })
    if (!response.ok) throw new Error(`连接失败（${response.status}）`)
  } else {
    const apiKey = resolveProviderApiKey(runtime)
    if (!apiKey) throw new Error('请先配置 API Key')
    const response = await fetch(modelsEndpoint(runtime), {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12000)
    })
    if (!response.ok && response.status !== 404 && response.status !== 405) {
      throw new Error(`连接失败（${response.status}）`)
    }
  }
  return { ok: true, message: '连接正常', latencyMs: Date.now() - startedAt }
}

function decryptLegacyApiKey(cipher) {
  if (!cipher) return ''
  if (!secureStorageAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    return ''
  }
}

function secureStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false
  return !(
    process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text'
  )
}

function resolveProviderApiKey(runtime) {
  return String(runtime.apiKey || '').trim() || decryptLegacyApiKey(runtime.apiKeyCipher)
}

async function migrateLegacyProviderApiKeys() {
  const legacyKeys = await coreRpc.request('legacy_provider_api_keys')
  if (!legacyKeys.length) return
  if (!secureStorageAvailable()) {
    console.warn(
      'Legacy provider API Keys could not be migrated because secure storage is unavailable'
    )
    return
  }
  for (const item of legacyKeys) {
    const apiKey = decryptLegacyApiKey(item.apiKeyCipher)
    if (!apiKey) {
      console.warn(`Legacy provider API Key could not be migrated: ${item.providerId}`)
      continue
    }
    await coreRpc.request('migrate_provider_api_key', {
      providerId: item.providerId,
      apiKey
    })
  }
}

function chatEndpoint(runtime) {
  if (runtime.providerType === 'ollama') return joinUrl(runtime.baseUrl, '/api/chat')
  const base = String(runtime.baseUrl || '').replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(base)) return base
  if (/\/v1$/i.test(base) || /\/api\/v3$/i.test(base)) return `${base}/chat/completions`
  if (runtime.providerType === 'volcengine' || runtime.providerType === 'ark') {
    return `${base}/api/v3/chat/completions`
  }
  return `${base}/v1/chat/completions`
}

function modelsEndpoint(runtime) {
  const base = String(runtime.baseUrl || '').replace(/\/+$/, '')
  if (/\/v1$/i.test(base) || /\/api\/v3$/i.test(base)) return `${base}/models`
  if (runtime.providerType === 'volcengine' || runtime.providerType === 'ark') {
    return `${base}/api/v3/models`
  }
  return `${base}/v1/models`
}

function safeRemoteMessage(text) {
  const payload = parseJson(text, null)
  return String(payload?.error?.message || payload?.message || text || '未知错误').slice(0, 800)
}

function registerAssetProtocol() {
  protocol.handle('rsclaw-asset', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const root = path.resolve(app.getPath('userData'), 'projects')
    const resolved = path.resolve(filePath)
    if (!isPathInside(root, resolved) || !existsSync(resolved)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(resolved).toString())
  })
}

async function openDialog(options) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title,
    defaultPath: options.defaultPath,
    properties: [
      options.directory ? 'openDirectory' : 'openFile',
      ...(options.multiple ? ['multiSelections'] : [])
    ],
    filters: normalizeFilters(options.filters)
  })
  if (result.canceled) return null
  return options.multiple ? result.filePaths : result.filePaths[0] || null
}

async function saveDialog(options) {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options.title,
    defaultPath: options.defaultPath,
    filters: normalizeFilters(options.filters)
  })
  return result.canceled ? null : result.filePath || null
}

function copyImageToClipboard(sourcePath) {
  const root = path.resolve(app.getPath('userData'), 'projects')
  const resolved = path.resolve(String(sourcePath || ''))
  if (!isPathInside(root, resolved) || !existsSync(resolved)) {
    throw new Error('本地图片不存在')
  }
  const image = nativeImage.createFromPath(resolved)
  if (image.isEmpty()) throw new Error('该图片格式暂不支持复制')
  clipboard.writeImage(image)
  return true
}

function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return undefined
  return filters.map((filter) => ({
    name: String(filter.name || '文件'),
    extensions: (filter.extensions || []).map((value) => String(value).replace(/^\./, ''))
  }))
}

async function importProviderEnvironment(sourcePath) {
  const content = await readFile(sourcePath, 'utf8')
  const env = Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '')
        ]
      })
  )
  const candidates = [
    {
      prefix: 'OPENAI',
      name: 'OpenAI',
      providerType: 'openai-compatible',
      defaultUrl: 'https://api.openai.com',
      apiKey: env.OPENAI_API_KEY
    },
    {
      prefix: 'DEEPSEEK',
      name: 'DeepSeek',
      providerType: 'deepseek',
      defaultUrl: 'https://api.deepseek.com',
      apiKey: env.DEEPSEEK_API_KEY
    },
    {
      prefix: 'GRSAI',
      name: 'GRSAI',
      providerType: 'grsai',
      defaultUrl: 'https://grsai.dakka.com.cn',
      apiKey: env.GRSAI_API_KEY
    },
    {
      prefix: 'APIMART',
      name: 'APIMart',
      providerType: 'apimart',
      defaultUrl: 'https://api.apimart.ai',
      apiKey: env.APIMART_API_KEY
    },
    {
      prefix: 'ARK',
      name: '火山方舟 Ark',
      providerType: 'ark',
      defaultUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: env.ARK_API_KEY || env.VOLCENGINE_API_KEY
    },
    {
      prefix: 'MINIMAX',
      name: 'MiniMax',
      providerType: 'minimax',
      defaultUrl: 'https://api.minimaxi.com',
      apiKey: env.MINIMAX_API_KEY
    }
  ]
  const profiles = await coreRpc.request('invoke', {
    command: 'list_provider_profiles',
    args: {}
  })
  const imported = []
  for (const candidate of candidates) {
    if (!candidate.apiKey) continue
    const existing = profiles.find((profile) => profile.providerType === candidate.providerType)
    const input = {
      id: existing?.id,
      name: existing?.name || candidate.name,
      providerType: candidate.providerType,
      baseUrl: env[`${candidate.prefix}_BASE_URL`] || existing?.baseUrl || candidate.defaultUrl,
      apiKey: candidate.apiKey,
      enabled: existing?.enabled ?? true,
      models: existing?.models || []
    }
    imported.push(await saveProviderWithPlaintextKey(input))
  }
  return {
    imported: imported.length,
    providerTypes: imported.map((profile) => profile.providerType)
  }
}

function joinUrl(base, pathname) {
  return `${String(base || '').replace(/\/+$/, '')}${pathname}`
}

function isPathInside(root, target) {
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function forwardEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('rsclaw:agent-event', event)
  }
}

function pipeWorkerErrors(child, label) {
  child.stderr?.on('data', (chunk) => console.error(`[${label}] ${String(chunk).trimEnd()}`))
}

function startTaskPump() {
  taskPump = createConcurrentTaskPump({
    concurrency: 4,
    claim: () =>
      coreRpc.request('invoke', {
        command: 'claim_next_task',
        args: {}
      }),
    process: processClaimedTask,
    onError: (error) => console.error('Media task pump failed:', error)
  })
  taskTimer = setInterval(() => taskPump.run(), 1000)
  void taskPump.run()
}

async function processClaimedTask({ operation, task }) {
  let state
  try {
    const runtime = await coreRpc.request('provider_runtime', { providerId: task.providerId })
    const apiKey = resolveProviderApiKey(runtime)
    state =
      operation === 'start'
        ? await startProviderTask(runtime, apiKey, task)
        : await pollProviderTask(runtime, apiKey, task)
  } catch (error) {
    if (operation === 'poll' && task.providerTaskId) {
      await coreRpc.request('invoke', {
        command: 'schedule_task_poll',
        args: {
          taskId: task.id,
          providerTaskId: task.providerTaskId,
          progress: task.progress,
          errorMessage: error.message
        }
      })
      return
    }
    await coreRpc.request('invoke', {
      command: 'fail_task',
      args: { taskId: task.id, errorMessage: error.message }
    })
    return
  }

  if (state.status === 'completed') {
    await coreRpc.request(
      'invoke',
      {
        command: 'materialize_task',
        args: {
          taskId: task.id,
          results: state.results,
          output: state.output
        }
      },
      600000
    )
  } else if (state.status === 'failed') {
    await coreRpc.request('invoke', {
      command: 'fail_task',
      args: {
        taskId: task.id,
        errorMessage: state.errorMessage || '供应商任务失败'
      }
    })
  } else {
    await coreRpc.request('invoke', {
      command: 'schedule_task_poll',
      args: {
        taskId: task.id,
        providerTaskId: state.providerTaskId,
        progress: state.progress,
        output: state.output,
        errorMessage: state.errorMessage
      }
    })
  }
}
