import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import v8 from 'node:v8'
import { DatabaseSync } from 'node:sqlite'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { assessCanvasDraftConflict } from '../canvas-draft-conflict.mjs'
import {
  canConnectCanvasNodes,
  imageReferenceAssetIds,
  imageTaskRequest
} from '../canvas-generation.mjs'
import { reflowCreateNodeOperations } from '../creative-workflow.mjs'
import { applyDraftPromptEdits } from '../draft-prompt.mjs'
import {
  BUILTIN_PROVIDER_DEFINITIONS,
  builtinProviderDefinition,
  withBuiltinProviderFields
} from '../builtin-providers.mjs'
import { deleteProviderProfileRecord } from '../provider-profile-store.mjs'
import { ParentRpc } from '../rpc.mjs'
import {
  findCanvasNodes,
  normalizeCanvasOperations,
  uniqueCanvasNodeName
} from '../canvas-node-resolution.mjs'
import { getSystemSkill, loadSystemSkills, systemSkillSummary } from '../system-skills.mjs'

const MAX_PROJECT_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 256

const appDataDir = process.argv[2]
if (!appDataDir) throw new Error('Core worker requires an application data directory')
const { parentPort } = process
if (!parentPort) throw new Error('Core worker must run as an Electron utility process')

await mkdir(path.join(appDataDir, 'projects'), { recursive: true })
await mkdir(path.join(appDataDir, 'backups'), { recursive: true })
await mkdir(path.join(appDataDir, 'logs'), { recursive: true })

const database = new DatabaseSync(path.join(appDataDir, 'rsclaw.db'))
database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
migrate()

const rpc = new ParentRpc(parentPort, {
  invoke: ({ command, args }) => invoke(command, args || {}),
  agent_tool: ({ name, args, context }) => executeAgentTool(name, args || {}, context || {}),
  checkpoint_load: () => loadCheckpointState(),
  checkpoint_save: ({ state }) => saveCheckpointState(state),
  provider_runtime: ({ providerId }) => providerRuntime(providerId),
  legacy_provider_api_keys: () => listLegacyProviderApiKeys(),
  migrate_provider_api_key: ({ providerId, apiKey }) => migrateProviderApiKey(providerId, apiKey),
  agent_event: ({ event }) => persistAgentEvent(event)
})

parentPort.postMessage({ kind: 'rpc.event', event: { type: 'core.ready' } })

function migrate() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      canvas_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      viewport_json TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS provider_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      options_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      model_type TEXT NOT NULL,
      size_specs_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider_id, model_type, model_id),
      FOREIGN KEY(provider_id) REFERENCES provider_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_assets_project_created
      ON assets(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      node_id TEXT,
      provider_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      provider_task_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      request_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      next_poll_at TEXT,
      poll_attempts INTEGER NOT NULL DEFAULT 0,
      deadline_at TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project_updated
      ON tasks(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS custom_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prompt_template TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assistant_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      actions_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_threads_project
      ON agent_threads(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL,
      input_text TEXT NOT NULL,
      step_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_thread
      ON agent_runs(thread_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_events (
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(run_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS agent_drafts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      expected_version INTEGER NOT NULL,
      plan_json TEXT NOT NULL,
      operations_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_run_snapshots (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      canvas_json TEXT NOT NULL,
      viewport_json TEXT NOT NULL,
      canvas_version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_run_skill_bundles (
      run_id TEXT PRIMARY KEY,
      bundle_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_run_skills (
      run_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      skill_kind TEXT NOT NULL,
      skill_revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      skill_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'activated',
      activated_at TEXT NOT NULL,
      PRIMARY KEY(run_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS agent_checkpoint_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      payload BLOB NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  ensureColumn('provider_profiles', 'api_key', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('provider_profiles', 'api_key_cipher', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('tasks', 'poll_attempts', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('tasks', 'deadline_at', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('agent_runs', 'skill_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('agent_runs', 'agent_route', "TEXT NOT NULL DEFAULT 'general'")
  ensureColumn('agent_drafts', 'base_canvas_fingerprint', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('custom_skills', 'revision', 'INTEGER NOT NULL DEFAULT 1')
  ensureBuiltinProviderRecords()
  migrateLegacySkills()
  database.exec(`
    UPDATE tasks
    SET status = CASE WHEN provider_task_id = '' THEN 'queued' ELSE 'polling' END,
        next_poll_at = NULL,
        updated_at = datetime('now')
    WHERE status IN ('submitting', 'checking', 'materializing', 'materializing_active');
    UPDATE agent_runs
    SET status = 'failed',
        error_message = '应用重启，未完成的执行已停止，请重新发送。',
        updated_at = datetime('now')
    WHERE status IN ('planning', 'running');
    UPDATE agent_runs
    SET status = 'awaiting_approval',
        error_message = '',
        updated_at = datetime('now')
    WHERE status = 'failed'
      AND error_message = 'CANVAS_VERSION_CONFLICT'
      AND EXISTS (
        SELECT 1 FROM agent_drafts
        WHERE agent_drafts.run_id = agent_runs.id
          AND agent_drafts.status = 'proposed'
      );
  `)
  removeStoredNegativePrompts()
}

function ensureBuiltinProviderRecords() {
  const timestamp = now()
  const update = database.prepare(
    `UPDATE provider_profiles
     SET name = ?, base_url = ?, enabled = 1, updated_at = ?
     WHERE provider_type = ?`
  )
  const insert = database.prepare(
    `INSERT INTO provider_profiles(
       id, name, provider_type, base_url, enabled, options_json,
       api_key_cipher, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 1, '{}', '', ?, ?)`
  )
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const provider of BUILTIN_PROVIDER_DEFINITIONS) {
      const changed = update.run(
        provider.name,
        provider.baseUrl,
        timestamp,
        provider.providerType
      ).changes
      if (!changed) {
        insert.run(
          provider.id,
          provider.name,
          provider.providerType,
          provider.baseUrl,
          timestamp,
          timestamp
        )
      }
    }
    database.exec('COMMIT')
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
  }
}

function removeStoredNegativePrompts() {
  const rows = database.prepare('SELECT id, canvas_json FROM projects').all()
  const update = database.prepare(
    `UPDATE projects
     SET canvas_json = ?, version = version + 1, updated_at = ?
     WHERE id = ?`
  )
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const row of rows) {
      const canvas = parseJson(row.canvas_json, null)
      if (!canvas || !Array.isArray(canvas.nodes)) continue
      let changed = false
      for (const node of canvas.nodes) {
        if (!node?.data || !Object.hasOwn(node.data, 'negativePrompt')) continue
        const cleanedPrompt = removeAppendedNegativePrompt(
          node.data.prompt,
          node.data.negativePrompt
        )
        if (cleanedPrompt !== node.data.prompt) node.data.prompt = cleanedPrompt
        delete node.data.negativePrompt
        changed = true
      }
      if (changed) update.run(JSON.stringify(canvas), now(), row.id)
    }
    database.exec('COMMIT')
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
  }
}

function ensureColumn(table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function tableExists(table) {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  )
}

function migrateLegacySkills() {
  if (!tableExists('canvas_skills')) return
  const rows = database
    .prepare(
      `SELECT id, name, description, prompt_template, enabled, sort_order, created_at, updated_at
       FROM canvas_skills`
    )
    .all()
  const insert = database.prepare(`
    INSERT OR IGNORE INTO custom_skills(
      id, name, description, prompt_template, enabled, sort_order, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `)
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const row of rows) {
      if (getSystemSkill(row.id)) continue
      insert.run(
        row.id,
        row.name,
        row.description,
        row.prompt_template,
        row.enabled,
        row.sort_order,
        row.created_at || now(),
        row.updated_at || now()
      )
    }
    database.exec('DROP TABLE canvas_skills')
    database.exec('COMMIT')
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
  }
}

async function invoke(command, args) {
  const handlers = {
    list_projects: listProjects,
    create_project: () => createProject(args.name),
    get_project: () => getProject(args.id),
    rename_project: () => renameProject(args.id, args.name),
    duplicate_project: () => duplicateProject(args.id),
    delete_project: () => deleteProject(args.id),
    list_deleted_projects: listDeletedProjects,
    restore_project: () => restoreProject(args.id),
    save_canvas: () =>
      saveCanvas(args.id, args.canvasJson, args.viewportJson, args.expectedVersion),
    list_project_backups: () => listProjectBackups(args.projectId),
    restore_project_backup: () => restoreProjectBackup(args.projectId, args.fileName),
    export_project: () => exportProject(args.id, args.destinationPath),
    import_project: () => importProject(args.sourcePath),
    list_provider_profiles: listProviderProfiles,
    save_provider_profile: () => saveProviderProfile(args.input),
    delete_provider_profile: () => deleteProviderProfile(args.id),
    get_provider_runtime: () => providerRuntime(args.providerId),
    list_assets: () => listAssets(args.projectId),
    import_asset: () => importAsset(args.projectId, args.sourcePath, args.kind),
    export_asset: () => exportAsset(args.assetId, args.destinationPath),
    list_tasks: () => listTasks(args.projectId),
    enqueue_task: () => enqueueTask(args),
    cancel_task: () =>
      updateTaskStatus(
        args.id,
        ['queued', 'submitting', 'submitted', 'polling', 'checking'],
        'canceled'
      ),
    retry_task: () => retryTask(args.id),
    claim_next_task: claimNextTask,
    schedule_task_poll: () => scheduleTaskPoll(args),
    materialize_task: () => materializeTask(args),
    fail_task: () => failTask(args),
    list_canvas_skills: listCanvasSkills,
    get_custom_skill_detail: () => getCustomSkillDetail(args.id),
    save_custom_skill: () => saveCustomSkill(args.input),
    delete_custom_skill: () => deleteCustomSkill(args.id),
    list_enabled_skills_for_agent: listEnabledSkillsForAgent,
    resolve_canvas_skill_for_agent: () => resolveCanvasSkillForAgent(args.id),
    list_assistant_messages: () => listAssistantMessages(args.projectId),
    clear_assistant_messages: () => clearAssistantMessages(args.projectId),
    insert_assistant_message: () => insertAssistantMessage(args),
    resolve_assistant_approval_message: () => resolveAssistantApprovalMessage(args),
    get_storage_info: getStorageInfo,
    create_agent_run: () => createAgentRun(args),
    update_agent_run: () => updateAgentRun(args),
    get_agent_run: () => getAgentRun(args.runId),
    get_agent_run_context_for_agent: () => getAgentRunContextForAgent(args.runId),
    activate_agent_skill: () => activateAgentSkill(args),
    get_pending_agent_approval: () => getPendingAgentApproval(args.projectId),
    list_agent_events: () => listAgentEvents(args.runId),
    create_agent_draft: () => createAgentDraft(args),
    get_agent_draft: () => getAgentDraft(args.draftId),
    get_proposed_agent_draft: () => getProposedAgentDraft(args.runId),
    commit_agent_draft: () => commitAgentDraft(args.draftId),
    reject_agent_drafts: () => rejectAgentDrafts(args.runId),
    undo_agent_run: () => undoAgentRun(args.runId)
  }
  const handler = handlers[command]
  if (!handler) throw new Error(`Unsupported core command: ${command}`)
  return handler()
}

function listProjects() {
  const rows = database
    .prepare(
      `SELECT id, name, canvas_json, viewport_json, version, created_at, updated_at
       FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC`
    )
    .all()
  const assetPaths = new Map(
    database
      .prepare('SELECT id, relative_path FROM assets')
      .all()
      .map((row) => [row.id, row.relative_path])
  )
  return rows.map((row) => projectSummary(row, assetPaths))
}

function projectSummary(row, assetPaths) {
  const canvas = parseJson(row.canvas_json, { nodes: [], edges: [] })
  const stats = { image: 0, video: 0, audio: 0, total: 0 }
  let coverAbsolutePath = ''
  for (const node of canvas.nodes || []) {
    if (!['image', 'video', 'audio'].includes(node.type)) continue
    stats[node.type] += 1
    stats.total += 1
    if (!coverAbsolutePath && node.type === 'image' && assetPaths.has(node.data?.assetId)) {
      coverAbsolutePath = safeAppDataPath(assetPaths.get(node.data.assetId))
    }
  }
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats,
    coverAbsolutePath
  }
}

function createProject(name = '未命名项目') {
  const id = `project_${randomUUID()}`
  const timestamp = now()
  database
    .prepare(
      `INSERT INTO projects(
        id, name, canvas_json, viewport_json, version, created_at, updated_at
      ) VALUES (?, ?, '{"nodes":[],"edges":[]}', '{"x":0,"y":0,"zoom":1}', 1, ?, ?)`
    )
    .run(id, normalizeName(name, '未命名项目'), timestamp, timestamp)
  return getProject(id)
}

function getProject(id) {
  const row = database
    .prepare(
      `SELECT id, name, canvas_json, viewport_json, version, created_at, updated_at
       FROM projects WHERE id = ? AND deleted_at IS NULL`
    )
    .get(id)
  if (!row) throw new Error('项目不存在')
  return projectRecord(row)
}

function projectRecord(row) {
  return {
    id: row.id,
    name: row.name,
    canvasJson: row.canvas_json,
    viewportJson: row.viewport_json,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function renameProject(id, name) {
  const timestamp = now()
  const changed = database
    .prepare(
      `UPDATE projects SET name = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(normalizeName(name, '未命名项目'), timestamp, id).changes
  if (!changed) throw new Error('项目不存在')
  return getProject(id)
}

async function duplicateProject(id) {
  const source = getProject(id)
  const copy = createProject(`${source.name} 副本`)
  const idMap = new Map()
  for (const asset of listAssets(id)) {
    const imported = await importAsset(copy.id, asset.absolutePath, asset.kind)
    idMap.set(asset.id, imported.id)
  }
  const canvas = parseJson(source.canvasJson, { nodes: [], edges: [] })
  for (const node of canvas.nodes || []) {
    if (node.data?.assetId && idMap.has(node.data.assetId)) {
      node.data.assetId = idMap.get(node.data.assetId)
    }
    delete node.data?.taskId
    delete node.data?.taskStatus
  }
  return saveCanvas(copy.id, JSON.stringify(canvas), source.viewportJson, copy.version)
}

function deleteProject(id) {
  const timestamp = now()
  const activeTasks = database
    .prepare(
      `SELECT id FROM tasks
       WHERE project_id = ? AND status NOT IN ('completed', 'failed', 'canceled')`
    )
    .all(id)
  database.exec('BEGIN IMMEDIATE')
  try {
    const changed = database
      .prepare(
        `UPDATE projects SET deleted_at = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND deleted_at IS NULL`
      )
      .run(timestamp, timestamp, id).changes
    if (!changed) throw new Error('项目不存在')
    database
      .prepare(
        `UPDATE tasks SET status = 'canceled', next_poll_at = NULL,
         error_message = '项目已删除，任务已取消', updated_at = ?
         WHERE project_id = ? AND status NOT IN ('completed', 'failed', 'canceled')`
      )
      .run(timestamp, id)
    database.exec('COMMIT')
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
  }
  for (const task of activeTasks) {
    rpc.emit({ type: 'task.canceled', taskId: task.id, projectId: id })
  }
}

function listDeletedProjects() {
  return database
    .prepare(
      `SELECT id, name, canvas_json, viewport_json, version, created_at, updated_at
       FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    )
    .all()
    .map(projectRecord)
}

function restoreProject(id) {
  const changed = database
    .prepare(
      `UPDATE projects SET deleted_at = NULL, updated_at = ?, version = version + 1
       WHERE id = ? AND deleted_at IS NOT NULL`
    )
    .run(now(), id).changes
  if (!changed) throw new Error('回收站中没有该项目')
  return getProject(id)
}

async function saveCanvas(id, canvasJson, viewportJson, expectedVersion) {
  parseJson(canvasJson, null, '画布数据不是有效 JSON')
  parseJson(viewportJson, null, '视口数据不是有效 JSON')
  const current = getProject(id)
  if (current.version !== expectedVersion) throw new Error('项目版本已变化，请重新加载后保存')
  if (current.canvasJson === canvasJson && current.viewportJson === viewportJson) return current
  const timestamp = now()
  const changed = database
    .prepare(
      `UPDATE projects
       SET canvas_json = ?, viewport_json = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL AND version = ?`
    )
    .run(canvasJson, viewportJson, timestamp, id, expectedVersion).changes
  if (!changed) throw new Error('项目版本已变化，请重新加载后保存')
  const project = getProject(id)
  await maybeBackupProject(project)
  return project
}

async function maybeBackupProject(project) {
  const directory = path.join(appDataDir, 'backups', project.id)
  await mkdir(directory, { recursive: true })
  const existing = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
  if (existing.length) {
    const latest = await stat(path.join(directory, existing.at(-1)))
    if (Date.now() - latest.mtimeMs < 5 * 60 * 1000) return
  }
  const fileName = `${new Date().toISOString().replaceAll(':', '-')}.json`
  const destination = path.join(directory, fileName)
  const temporary = `${destination}.part`
  await writeFile(
    temporary,
    JSON.stringify({
      projectId: project.id,
      version: project.version,
      canvasJson: project.canvasJson,
      viewportJson: project.viewportJson,
      createdAt: now()
    })
  )
  await rename(temporary, destination)
  const retained = [...existing, fileName]
  for (const stale of retained.slice(0, Math.max(0, retained.length - 20))) {
    await rm(path.join(directory, stale), { force: true })
  }
}

async function listProjectBackups(projectId) {
  const directory = path.join(appDataDir, 'backups', projectId)
  if (!existsSync(directory)) return []
  const files = await readdir(directory)
  return Promise.all(
    files
      .filter((name) => name.endsWith('.json'))
      .map(async (fileName) => {
        const info = await stat(path.join(directory, fileName))
        return { fileName, createdAt: info.mtime.toISOString(), fileSize: info.size }
      })
  )
}

async function restoreProjectBackup(projectId, fileName) {
  if (path.basename(fileName) !== fileName) throw new Error('备份文件名无效')
  const payload = parseJson(
    await readFile(path.join(appDataDir, 'backups', projectId, fileName), 'utf8'),
    null,
    '备份内容无效'
  )
  const project = getProject(projectId)
  return saveCanvas(
    projectId,
    payload.canvasJson || payload.canvas_json,
    payload.viewportJson || payload.viewport_json,
    project.version
  )
}

async function exportProject(id, destinationPath) {
  const project = getProject(id)
  const assets = listAssets(id)
  const totalAssetBytes = assets.reduce((total, asset) => total + asset.fileSize, 0)
  if (totalAssetBytes > MAX_PROJECT_ARCHIVE_BYTES) {
    throw new Error('项目素材总量超过 512MB，暂时无法导出为单个项目包')
  }
  const entries = {
    'manifest.json': strToU8(
      JSON.stringify({ schemaVersion: 1, app: 'rsclaw-canvas', exportedAt: now() }, null, 2)
    ),
    'project.json': strToU8(
      JSON.stringify(
        {
          name: project.name,
          canvasJson: project.canvasJson,
          viewportJson: project.viewportJson,
          assets: assets.map((asset) => ({
            id: asset.id,
            kind: asset.kind,
            archivePath: `assets/${asset.id}${path.extname(asset.absolutePath)}`,
            mimeType: asset.mimeType,
            fileSize: asset.fileSize,
            sha256: asset.sha256,
            metadataJson: asset.metadataJson
          }))
        },
        null,
        2
      )
    )
  }
  for (const asset of assets) {
    entries[`assets/${asset.id}${path.extname(asset.absolutePath)}`] = new Uint8Array(
      await readFile(asset.absolutePath)
    )
  }
  const temporary = `${destinationPath}.part`
  await writeFile(temporary, zipSync(entries, { level: 6 }))
  await rename(temporary, destinationPath)
  return destinationPath
}

async function importProject(sourcePath) {
  const sourceInfo = await stat(sourcePath)
  if (!sourceInfo.isFile() || sourceInfo.size > MAX_PROJECT_ARCHIVE_BYTES) {
    throw new Error('项目包无效或超过 512MB')
  }
  let totalExpandedBytes = 0
  let entryCount = 0
  const entries = unzipSync(new Uint8Array(await readFile(sourcePath)), {
    filter(entry) {
      entryCount += 1
      totalExpandedBytes += entry.originalSize
      if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('项目包文件数量过多')
      if (entry.originalSize > MAX_ARCHIVE_ENTRY_BYTES) throw new Error('项目包单个文件超过 256MB')
      if (totalExpandedBytes > MAX_PROJECT_ARCHIVE_BYTES) throw new Error('项目包展开后超过 512MB')
      return true
    }
  })
  const manifest = parseJson(
    entries['manifest.json'] ? strFromU8(entries['manifest.json']) : '',
    null,
    '项目包清单无效'
  )
  if (manifest.schemaVersion !== 1) throw new Error('不支持的项目包版本')
  const archived = parseJson(
    entries['project.json'] ? strFromU8(entries['project.json']) : '',
    null,
    '项目包内容无效'
  )
  const project = createProject(archived.name)
  const idMap = new Map()
  try {
    for (const asset of archived.assets || []) {
      if (!/^assets\/[a-zA-Z0-9_.-]+$/.test(asset.archivePath)) {
        throw new Error('项目包包含无效素材路径')
      }
      const entry = entries[asset.archivePath]
      if (!entry) throw new Error(`项目包缺少素材 ${asset.archivePath}`)
      const targetDir = path.join(appDataDir, 'projects', project.id, 'assets', 'imported')
      await mkdir(targetDir, { recursive: true })
      const target = path.join(targetDir, `asset_${randomUUID()}${path.extname(asset.archivePath)}`)
      await writeFile(target, entry)
      const imported = await importAsset(project.id, target, asset.kind)
      await rm(target, { force: true })
      idMap.set(asset.id, imported.id)
    }
    const canvas = parseJson(archived.canvasJson, { nodes: [], edges: [] })
    for (const node of canvas.nodes || []) {
      if (node.data?.assetId && idMap.has(node.data.assetId)) {
        node.data.assetId = idMap.get(node.data.assetId)
      }
      delete node.data?.taskId
      delete node.data?.taskStatus
    }
    return saveCanvas(
      project.id,
      JSON.stringify(canvas),
      archived.viewportJson || '{"x":0,"y":0,"zoom":1}',
      project.version
    )
  } catch (error) {
    deleteProject(project.id)
    throw error
  }
}

function listProviderProfiles() {
  const profiles = database
    .prepare(
      `SELECT id, name, provider_type, base_url, enabled, created_at, updated_at,
              api_key,
              CASE WHEN api_key <> '' OR api_key_cipher <> '' THEN 1 ELSE 0 END AS has_api_key
       FROM provider_profiles
       ORDER BY CASE provider_type
         WHEN 'grsai' THEN 0
         WHEN 'deepseek' THEN 1
         ELSE 2
       END, updated_at DESC`
    )
    .all()
  const modelStatement = database.prepare(
    `SELECT id, model_id, display_name, model_type, size_specs_json
     FROM provider_models WHERE provider_id = ? ORDER BY sort_order ASC`
  )
  return profiles.map((row) => ({
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    enabled: Boolean(row.enabled),
    isBuiltin: Boolean(builtinProviderDefinition(row.provider_type)),
    officialUrl: builtinProviderDefinition(row.provider_type)?.officialUrl || '',
    apiKey: row.api_key,
    hasApiKey: Boolean(row.has_api_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    models: modelStatement.all(row.id).map((model) => ({
      id: model.id,
      modelId: model.model_id,
      displayName: model.display_name || model.model_id,
      modelType: model.model_type,
      sizeSpecs: parseJson(model.size_specs_json, [])
    }))
  }))
}

function saveProviderProfile(input) {
  let id = input.id?.trim() || `provider_${randomUUID()}`
  const timestamp = now()
  let existing = database
    .prepare(
      `SELECT api_key, api_key_cipher, created_at, provider_type
       FROM provider_profiles WHERE id = ?`
    )
    .get(id)
  const existingBuiltin = builtinProviderDefinition(existing?.provider_type)
  const requestedBuiltin = builtinProviderDefinition(input.providerType)
  if (existing && !existingBuiltin && requestedBuiltin) {
    throw new Error('系统内置供应商类型不可用于自定义供应商')
  }
  if (!existing && requestedBuiltin) {
    const systemProvider = database
      .prepare('SELECT id FROM provider_profiles WHERE provider_type = ? LIMIT 1')
      .get(requestedBuiltin.providerType)
    if (systemProvider) throw new Error('该系统内置供应商已存在')
    id = requestedBuiltin.id
    existing = null
  }
  const builtin = existingBuiltin || requestedBuiltin
  const normalizedInput = builtin ? withBuiltinProviderFields(input, builtin) : input
  const hasApiKeyInput = typeof input.apiKey === 'string'
  const apiKey = hasApiKeyInput ? input.apiKey.trim() : existing?.api_key || ''
  const legacyCipher = hasApiKeyInput ? '' : existing?.api_key_cipher || ''
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO provider_profiles(
          id, name, provider_type, base_url, enabled, options_json,
          api_key, api_key_cipher, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          provider_type = excluded.provider_type,
          base_url = excluded.base_url,
          enabled = excluded.enabled,
          api_key = excluded.api_key,
          api_key_cipher = excluded.api_key_cipher,
          updated_at = excluded.updated_at`
      )
      .run(
        id,
        normalizeName(normalizedInput.name, 'AI 供应商'),
        normalizedInput.providerType,
        String(normalizedInput.baseUrl || '').replace(/\/+$/, ''),
        normalizedInput.enabled === false ? 0 : 1,
        apiKey,
        legacyCipher,
        existing?.created_at || timestamp,
        timestamp
      )
    database.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(id)
    const insertModel = database.prepare(
      `INSERT INTO provider_models(
        id, provider_id, model_id, display_name, model_type, size_specs_json,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const [index, model] of (input.models || []).entries()) {
      insertModel.run(
        `provider_model_${randomUUID()}`,
        id,
        model.modelId,
        model.displayName || model.modelId,
        model.modelType,
        JSON.stringify(model.sizeSpecs || []),
        index,
        timestamp,
        timestamp
      )
    }
    database.exec('COMMIT')
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
  }
  return listProviderProfiles().find((item) => item.id === id)
}

function deleteProviderProfile(id) {
  deleteProviderProfileRecord(database, id)
}

function providerRuntime(providerId) {
  const row = database
    .prepare(
      `SELECT id, provider_type, base_url, api_key, api_key_cipher
       FROM provider_profiles WHERE id = ? AND enabled = 1`
    )
    .get(providerId)
  if (!row) throw new Error('供应商不存在或已停用')
  return {
    id: row.id,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    apiKeyCipher: row.api_key_cipher
  }
}

function listLegacyProviderApiKeys() {
  return database
    .prepare(
      `SELECT id, api_key_cipher
       FROM provider_profiles
       WHERE api_key = '' AND api_key_cipher <> ''`
    )
    .all()
    .map((row) => ({
      providerId: row.id,
      apiKeyCipher: row.api_key_cipher
    }))
}

function migrateProviderApiKey(providerId, apiKey) {
  const changed = database
    .prepare(
      `UPDATE provider_profiles
       SET api_key = ?, api_key_cipher = '', updated_at = ?
       WHERE id = ?`
    )
    .run(String(apiKey || '').trim(), now(), providerId).changes
  if (!changed) throw new Error('供应商不存在')
  return true
}

function listAssets(projectId) {
  ensureProject(projectId)
  return database
    .prepare(
      `SELECT id, project_id, kind, relative_path, mime_type, file_size,
              sha256, metadata_json, created_at
       FROM assets WHERE project_id = ? ORDER BY created_at DESC`
    )
    .all(projectId)
    .map(assetRecord)
}

function assetRecord(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    relativePath: row.relative_path,
    absolutePath: safeAppDataPath(row.relative_path),
    mimeType: row.mime_type,
    fileSize: row.file_size,
    sha256: row.sha256,
    metadataJson: row.metadata_json,
    createdAt: row.created_at
  }
}

async function importAsset(projectId, sourcePath, kind) {
  ensureProject(projectId)
  if (!['image', 'video', 'audio', 'file'].includes(kind)) throw new Error('素材类型不受支持')
  const sourceInfo = await stat(sourcePath)
  if (!sourceInfo.isFile()) throw new Error('请选择有效文件')
  if (sourceInfo.size > 4 * 1024 * 1024 * 1024) throw new Error('文件超过 4GB')
  const sha256 = await hashFile(sourcePath)
  const duplicate = database
    .prepare('SELECT * FROM assets WHERE project_id = ? AND sha256 = ? LIMIT 1')
    .get(projectId, sha256)
  if (duplicate) return assetRecord(duplicate)
  const id = `asset_${randomUUID()}`
  const extension =
    path
      .extname(sourcePath)
      .replace(/[^a-zA-Z0-9.]/g, '')
      .slice(0, 12) || '.bin'
  const directory = path.join(appDataDir, 'projects', projectId, 'assets', 'imported')
  await mkdir(directory, { recursive: true })
  const destination = path.join(directory, `${id}${extension}`)
  const temporary = `${destination}.part`
  await copyFile(sourcePath, temporary)
  if ((await hashFile(temporary)) !== sha256) {
    await rm(temporary, { force: true })
    throw new Error('素材复制校验失败')
  }
  await rename(temporary, destination)
  const relativePath = relativeAppPath(destination)
  const timestamp = now()
  database
    .prepare(
      `INSERT INTO assets(
        id, project_id, kind, relative_path, mime_type, file_size,
        sha256, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      projectId,
      kind,
      relativePath,
      mimeTypeForPath(destination, kind),
      sourceInfo.size,
      sha256,
      JSON.stringify({ originalFileName: path.basename(sourcePath) }),
      timestamp
    )
  return assetRecord(database.prepare('SELECT * FROM assets WHERE id = ?').get(id))
}

async function exportAsset(assetId, destinationPath) {
  const row = database.prepare('SELECT * FROM assets WHERE id = ?').get(assetId)
  if (!row) throw new Error('素材不存在')
  await copyFile(safeAppDataPath(row.relative_path), destinationPath)
  return destinationPath
}

function listTasks(projectId) {
  ensureProject(projectId)
  return database
    .prepare(
      `SELECT id, project_id, node_id, provider_id, task_type, provider_task_id,
              status, progress, request_json, result_json, next_poll_at,
              error_message, created_at, updated_at
       FROM tasks WHERE project_id = ? ORDER BY updated_at DESC`
    )
    .all(projectId)
    .map(taskRecord)
}

function enqueueTask(args) {
  ensureProject(args.projectId)
  providerRuntime(args.providerId)
  if (
    ![
      'text.generate',
      'image.generate',
      'image.edit',
      'video.generate',
      'video.extend',
      'audio.generate'
    ].includes(args.taskType)
  ) {
    throw new Error('任务类型不受支持')
  }
  const request = parseJson(args.requestJson, null, '任务请求不是有效 JSON')
  const requestJson = JSON.stringify(request)
  if (requestJson.length > 256 * 1024) throw new Error('任务请求超过 256KB')
  const id = `task_${randomUUID()}`
  const timestamp = now()
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  database
    .prepare(
      `INSERT INTO tasks(
        id, project_id, node_id, provider_id, task_type, status, progress,
        request_json, result_json, deadline_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, '{}', ?, ?, ?)`
    )
    .run(
      id,
      args.projectId,
      args.nodeId || null,
      args.providerId,
      args.taskType,
      requestJson,
      deadline,
      timestamp,
      timestamp
    )
  rpc.emit({ type: 'task.enqueued', taskId: id, projectId: args.projectId })
  return taskRecord(database.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
}

function taskRecord(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    nodeId: row.node_id,
    providerId: row.provider_id,
    taskType: row.task_type,
    providerTaskId: row.provider_task_id,
    status: row.status,
    progress: row.progress,
    requestJson: row.request_json,
    resultJson: row.result_json,
    nextPollAt: row.next_poll_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function updateTaskStatus(id, allowed, status) {
  const task = database.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  if (!task || !allowed.includes(task.status)) throw new Error('当前任务状态不能执行该操作')
  database
    .prepare('UPDATE tasks SET status = ?, next_poll_at = NULL, updated_at = ? WHERE id = ?')
    .run(status, now(), id)
  return taskRecord(database.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
}

function retryTask(id) {
  updateTaskStatus(id, ['failed', 'canceled'], 'queued')
  database
    .prepare(
      `UPDATE tasks SET provider_task_id = '', progress = 0, result_json = '{}',
       next_poll_at = NULL, poll_attempts = 0, error_message = '' WHERE id = ?`
    )
    .run(id)
  return taskRecord(database.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
}

async function claimNextTask() {
  const timestamp = now()
  database
    .prepare(
      `UPDATE tasks SET status = 'failed', next_poll_at = NULL,
       error_message = '任务已超过 24 小时截止时间', updated_at = ?
       WHERE status IN ('queued', 'polling') AND deadline_at <> '' AND deadline_at <= ?`
    )
    .run(timestamp, timestamp)
  database.exec('BEGIN IMMEDIATE')
  try {
    let row = database
      .prepare(
        `SELECT * FROM tasks
         WHERE status = 'queued' AND (deadline_at = '' OR deadline_at > ?)
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(timestamp)
    let nextStatus = 'submitting'
    if (!row) {
      row = database
        .prepare(
          `SELECT * FROM tasks
           WHERE status = 'polling'
             AND (next_poll_at IS NULL OR next_poll_at <= ?)
             AND (deadline_at = '' OR deadline_at > ?)
           ORDER BY COALESCE(next_poll_at, created_at) ASC LIMIT 1`
        )
        .get(timestamp, timestamp)
      nextStatus = 'checking'
    }
    if (!row) {
      database.exec('COMMIT')
      return null
    }
    database
      .prepare(
        `UPDATE tasks SET status = ?, progress = CASE WHEN progress < 5 THEN 5 ELSE progress END,
         poll_attempts = poll_attempts + ?, next_poll_at = NULL, updated_at = ? WHERE id = ?`
      )
      .run(nextStatus, nextStatus === 'checking' ? 1 : 0, timestamp, row.id)
    database.exec('COMMIT')
    const task = taskRecord(database.prepare('SELECT * FROM tasks WHERE id = ?').get(row.id))
    task.requestJson = await hydrateTaskReferences(task)
    return { operation: nextStatus === 'submitting' ? 'start' : 'poll', task }
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
  }
}

function scheduleTaskPoll(args) {
  const task = database.prepare('SELECT * FROM tasks WHERE id = ?').get(args.taskId)
  if (!task || !['submitting', 'checking'].includes(task.status)) return null
  const attempt = Number(task.poll_attempts || 0)
  const delaySeconds = attempt < 5 ? 2 : attempt < 20 ? 5 : attempt < 100 ? 15 : 30
  const nextPollAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
  database
    .prepare(
      `UPDATE tasks SET status = 'polling', provider_task_id = ?, progress = ?,
       result_json = ?, next_poll_at = ?, error_message = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      args.providerTaskId || task.provider_task_id,
      Math.max(5, Math.min(95, Number(args.progress || task.progress || 5))),
      JSON.stringify({ providerOutput: args.output || {} }),
      nextPollAt,
      String(args.errorMessage || ''),
      now(),
      args.taskId
    )
  return taskRecord(database.prepare('SELECT * FROM tasks WHERE id = ?').get(args.taskId))
}

async function materializeTask(args) {
  const row = database.prepare('SELECT * FROM tasks WHERE id = ?').get(args.taskId)
  if (!row || !['submitting', 'checking'].includes(row.status)) return null
  database
    .prepare(
      "UPDATE tasks SET status = 'materializing_active', progress = 96, updated_at = ? WHERE id = ?"
    )
    .run(now(), args.taskId)
  const assets = []
  try {
    for (const [index, result] of (args.results || []).slice(0, 12).entries()) {
      const kind = ['image', 'video', 'audio'].includes(result.kind)
        ? result.kind
        : row.task_type.split('.')[0]
      const mimeType = String(result.mimeType || `${kind}/octet-stream`)
      const bytes = await materializedBytes(result)
      if (!bytes.length) throw new Error('供应商返回了空结果')
      if (bytes.length > MAX_PROJECT_ARCHIVE_BYTES) throw new Error('生成结果超过 512MB')
      const directory = path.join(appDataDir, 'projects', row.project_id, 'assets', 'generated')
      await mkdir(directory, { recursive: true })
      const temporary = path.join(
        directory,
        `.task_${row.id}_${index}${extensionForMime(mimeType, kind)}.part`
      )
      await writeFile(temporary, bytes)
      const imported = await importAsset(row.project_id, temporary, kind)
      await rm(temporary, { force: true })
      assets.push(imported)
    }
    if (!assets.length) throw new Error('供应商没有返回可保存的媒体结果')
    database
      .prepare(
        `UPDATE tasks SET status = 'completed', progress = 100, result_json = ?,
         next_poll_at = NULL, error_message = '', updated_at = ? WHERE id = ?`
      )
      .run(JSON.stringify({ providerOutput: args.output || {}, assets }), now(), args.taskId)
    rpc.emit({ type: 'task.completed', taskId: args.taskId, projectId: row.project_id })
    return taskRecord(database.prepare('SELECT * FROM tasks WHERE id = ?').get(args.taskId))
  } catch (error) {
    return failTask({ taskId: args.taskId, errorMessage: error.message })
  }
}

function failTask(args) {
  const changed = database
    .prepare(
      `UPDATE tasks SET status = 'failed', next_poll_at = NULL, error_message = ?,
       updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'canceled')`
    )
    .run(String(args.errorMessage || '任务执行失败').slice(0, 2000), now(), args.taskId).changes
  if (!changed) return null
  const task = taskRecord(database.prepare('SELECT * FROM tasks WHERE id = ?').get(args.taskId))
  rpc.emit({ type: 'task.failed', taskId: args.taskId, projectId: task.projectId })
  return task
}

async function hydrateTaskReferences(task) {
  const request = parseJson(task.requestJson, {})
  const ids = [...new Set((request.referenceAssetIds || []).map(String))].slice(0, 8)
  if (!ids.length) return task.requestJson
  const referenceUrls = []
  const references = []
  for (const id of ids) {
    const row = database
      .prepare(
        `SELECT kind, relative_path, mime_type, file_size FROM assets
         WHERE id = ? AND project_id = ?`
      )
      .get(id, task.projectId)
    if (!row) throw new Error(`参考素材不存在：${id}`)
    if (row.file_size > 24 * 1024 * 1024) throw new Error('单个参考素材不能超过 24MB')
    const content = Buffer.from(await readFile(safeAppDataPath(row.relative_path))).toString(
      'base64'
    )
    const url = `data:${row.mime_type || 'application/octet-stream'};base64,${content}`
    referenceUrls.push(url)
    references.push({ url, kind: row.kind, role: `reference_${row.kind}` })
  }
  return JSON.stringify({ ...request, referenceUrls, references })
}

async function materializedBytes(result) {
  if (result.content) return Buffer.from(result.content, 'base64')
  const url = new URL(String(result.url || ''))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('生成结果 URL 不受支持')
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`下载生成结果失败（${response.status}）`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > MAX_PROJECT_ARCHIVE_BYTES) throw new Error('生成结果超过 512MB')
  return Buffer.from(await response.arrayBuffer())
}

function extensionForMime(mimeType, kind) {
  const known = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/mp4': '.m4a'
  }
  return (
    known[mimeType.toLowerCase()] || { image: '.png', video: '.mp4', audio: '.mp3' }[kind] || '.bin'
  )
}

function listCanvasSkills() {
  const customSkills = database
    .prepare(
      `SELECT id, name, description, enabled, sort_order, revision, created_at, updated_at
       FROM custom_skills ORDER BY sort_order ASC, updated_at DESC`
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: Boolean(row.enabled),
      sortOrder: row.sort_order,
      revision: row.revision,
      kind: 'custom',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      capabilities: {
        canViewContent: true,
        canEdit: true,
        canDelete: true,
        canToggle: true
      }
    }))
  return [...loadSystemSkills().map(systemSkillSummary), ...customSkills].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
  )
}

function customSkillFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    promptTemplate: row.prompt_template,
    enabled: Boolean(row.enabled),
    sortOrder: row.sort_order,
    revision: row.revision,
    kind: 'custom',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    capabilities: {
      canViewContent: true,
      canEdit: true,
      canDelete: true,
      canToggle: true
    }
  }
}

function getCustomSkillDetail(id) {
  if (getSystemSkill(id)) throw new Error('系统 Skill 内容不能从普通界面读取')
  const row = database.prepare('SELECT * FROM custom_skills WHERE id = ?').get(id)
  if (!row) throw new Error('自定义 Skill 不存在')
  return customSkillFromRow(row)
}

function resolveCanvasSkillForAgent(id) {
  if (!id) return null
  const systemSkill = getSystemSkill(id)
  if (systemSkill) return systemSkill
  const row = database.prepare('SELECT * FROM custom_skills WHERE id = ? AND enabled = 1').get(id)
  return customSkillFromRow(row)
}

function listEnabledSkillsForAgent() {
  const systemSkills = loadSystemSkills().map((skill) => ({
    ...skill,
    revision: skill.version
  }))
  const customSkills = database
    .prepare(
      `SELECT *
       FROM custom_skills
       WHERE enabled = 1
       ORDER BY sort_order ASC, updated_at DESC`
    )
    .all()
    .map(customSkillFromRow)
  return [...systemSkills, ...customSkills].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
  )
}

function saveCustomSkill(input = {}) {
  const requestedId = String(input.id || '').trim()
  if (getSystemSkill(requestedId) || requestedId.startsWith('skill_builtin_')) {
    throw new Error('系统 Skill 不可修改')
  }
  const name = String(input.name || '').trim()
  const description = String(input.description || '').trim()
  const promptTemplate = String(input.promptTemplate || '').trim()
  const sortOrder = Number(input.sortOrder || 0)
  if (!name) throw new Error('Skill 名称不能为空')
  if (!promptTemplate) throw new Error('Skill 提示规则不能为空')
  if (name.length > 80) throw new Error('Skill 名称不能超过 80 个字符')
  if (description.length > 200) throw new Error('Skill 说明不能超过 200 个字符')
  if (promptTemplate.length > 20000) throw new Error('Skill 提示规则不能超过 20000 个字符')
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    throw new Error('Skill 排序必须是 0 到 9999 的整数')
  }
  const id = requestedId || `skill_${randomUUID()}`
  const timestamp = now()
  database
    .prepare(
      `INSERT INTO custom_skills(
        id, name, description, prompt_template, enabled, sort_order, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        prompt_template = excluded.prompt_template,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        revision = custom_skills.revision + 1,
        updated_at = excluded.updated_at`
    )
    .run(
      id,
      name,
      description,
      promptTemplate,
      input.enabled === false ? 0 : 1,
      sortOrder,
      timestamp,
      timestamp
    )
  return getCustomSkillDetail(id)
}

function deleteCustomSkill(id) {
  const normalizedId = String(id || '').trim()
  if (getSystemSkill(normalizedId) || normalizedId.startsWith('skill_builtin_')) {
    throw new Error('系统 Skill 不可删除')
  }
  const changed = database
    .prepare('DELETE FROM custom_skills WHERE id = ?')
    .run(normalizedId).changes
  if (!changed) throw new Error('自定义 Skill 不存在')
}

function listAssistantMessages(projectId) {
  return database
    .prepare(
      `SELECT id, project_id, role, content, actions_json, created_at
       FROM (
         SELECT id, project_id, role, content, actions_json, created_at, rowid
         FROM assistant_messages WHERE project_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 200
       ) ORDER BY created_at ASC, rowid ASC`
    )
    .all(projectId)
    .map((row) => ({
      id: row.id,
      projectId: row.project_id,
      role: row.role,
      content: row.content,
      actionsJson: row.actions_json,
      createdAt: row.created_at
    }))
}

function insertAssistantMessage({ projectId, role, content, actions = [] }) {
  ensureProject(projectId)
  const message = {
    id: `message_${randomUUID()}`,
    projectId,
    role,
    content,
    actionsJson: JSON.stringify(actions),
    createdAt: now()
  }
  database
    .prepare(
      `INSERT INTO assistant_messages(
        id, project_id, role, content, actions_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.id,
      message.projectId,
      message.role,
      message.content,
      message.actionsJson,
      message.createdAt
    )
  return message
}

function resolveAssistantApprovalMessage({ runId, status, summary = '', promptEdits = [] }) {
  const run = getAgentRun(runId)
  const edits = new Map(
    (Array.isArray(promptEdits) ? promptEdits : [])
      .filter((edit) => Number.isInteger(edit?.operationIndex))
      .map((edit) => [edit.operationIndex, String(edit.prompt || '').slice(0, 20000)])
  )
  const rows = database
    .prepare(
      `SELECT id, actions_json FROM assistant_messages
       WHERE project_id = ? AND role = 'assistant'
         AND actions_json LIKE '%"agent_approval"%'
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(run.projectId)
  let changed = 0
  for (const row of rows) {
    const actions = parseJson(row.actions_json, [])
    if (!Array.isArray(actions)) continue
    let rowChanged = false
    const nextActions = actions.map((action) => {
      if (
        action?.type !== 'agent_approval' ||
        action.runId !== runId ||
        action.status !== 'pending'
      ) {
        return action
      }
      rowChanged = true
      return {
        ...action,
        status,
        resultSummary: String(summary || '').slice(0, 2000),
        resolvedAt: now(),
        items: Array.isArray(action.items)
          ? action.items.map((item) =>
              edits.has(item.operationIndex)
                ? { ...item, prompt: edits.get(item.operationIndex) }
                : item
            )
          : []
      }
    })
    if (!rowChanged) continue
    database
      .prepare('UPDATE assistant_messages SET actions_json = ? WHERE id = ?')
      .run(JSON.stringify(nextActions), row.id)
    changed += 1
  }
  return { runId, status, changed }
}

function clearAssistantMessages(projectId) {
  database.prepare('DELETE FROM assistant_messages WHERE project_id = ?').run(projectId)
}

function createAgentRun(args) {
  const timestamp = now()
  const threadId = args.threadId || `${args.projectId}:default`
  database
    .prepare(
      `INSERT OR IGNORE INTO agent_threads(
        id, project_id, title, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?)`
    )
    .run(
      threadId,
      args.projectId,
      String(args.content || '新对话').slice(0, 40),
      timestamp,
      timestamp
    )
  database
    .prepare(
      `INSERT INTO agent_runs(
        id, thread_id, request_id, project_id, provider_id, model_id,
        status, input_text, skill_id, agent_route, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?)`
    )
    .run(
      args.runId,
      threadId,
      args.requestId,
      args.projectId,
      args.providerId,
      args.model,
      args.content,
      args.skillId || '',
      args.agentRoute || 'general',
      timestamp,
      timestamp
    )
  if (args.skillBundle) {
    database
      .prepare(
        `INSERT OR REPLACE INTO agent_run_skill_bundles(run_id, bundle_json, created_at)
         VALUES (?, ?, ?)`
      )
      .run(args.runId, JSON.stringify(args.skillBundle), timestamp)
  }
  return getAgentRun(args.runId)
}

function updateAgentRun(args) {
  const fields = []
  const values = []
  for (const [key, column] of [
    ['status', 'status'],
    ['stepCount', 'step_count'],
    ['inputTokens', 'input_tokens'],
    ['outputTokens', 'output_tokens'],
    ['errorMessage', 'error_message'],
    ['agentRoute', 'agent_route']
  ]) {
    if (args[key] === undefined) continue
    fields.push(`${column} = ?`)
    values.push(args[key])
  }
  fields.push('updated_at = ?')
  values.push(now(), args.runId)
  database.prepare(`UPDATE agent_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getAgentRun(args.runId)
}

function getAgentRunContextForAgent(runId) {
  const run = getAgentRun(runId)
  const bundleRow = database
    .prepare('SELECT bundle_json FROM agent_run_skill_bundles WHERE run_id = ?')
    .get(runId)
  const activatedRow = database
    .prepare(
      `SELECT skill_id, skill_name, skill_kind, skill_revision, content_hash, skill_path,
              status, activated_at
       FROM agent_run_skills
       WHERE run_id = ? AND status = 'activated'
       ORDER BY activated_at ASC LIMIT 1`
    )
    .get(runId)
  const bundle = parseJson(bundleRow?.bundle_json, null)
  const activatedSkill = activatedRow
    ? (bundle?.skills || []).find(
        (skill) =>
          skill.id === activatedRow.skill_id &&
          skill.path === activatedRow.skill_path &&
          skill.contentHash === activatedRow.content_hash
      ) || null
    : null
  return { ...run, skillBundle: bundle, activatedSkill }
}

function activateAgentSkill(args) {
  const runId = String(args.runId || '').trim()
  const skillId = String(args.skillId || '').trim()
  const skillPath = String(args.skillPath || '').trim()
  const contentHash = String(args.contentHash || '').trim()
  if (!runId || !skillId || !skillPath || !contentHash) {
    throw new Error('Skill 激活记录不完整')
  }
  const bundleRow = database
    .prepare('SELECT bundle_json FROM agent_run_skill_bundles WHERE run_id = ?')
    .get(runId)
  const bundle = parseJson(bundleRow?.bundle_json, null)
  const skill = (bundle?.skills || []).find(
    (item) => item.id === skillId && item.path === skillPath && item.contentHash === contentHash
  )
  if (!skill) throw new Error('Skill 不属于本轮已冻结的候选快照')
  const existing = database
    .prepare(
      `SELECT skill_id FROM agent_run_skills
       WHERE run_id = ? AND status = 'activated'
       ORDER BY activated_at ASC LIMIT 1`
    )
    .get(runId)
  if (existing && existing.skill_id !== skill.id) {
    throw new Error('每次请求最多只能激活一个主 Skill')
  }
  const timestamp = now()
  database
    .prepare(
      `INSERT OR IGNORE INTO agent_run_skills(
        run_id, skill_id, skill_name, skill_kind, skill_revision,
        content_hash, skill_path, status, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'activated', ?)`
    )
    .run(
      runId,
      skill.id,
      skill.name,
      skill.kind,
      Number(skill.revision || 1),
      skill.contentHash,
      skill.path,
      timestamp
    )
  database
    .prepare(`UPDATE agent_runs SET skill_id = ?, updated_at = ? WHERE id = ?`)
    .run(skill.id, timestamp, runId)
  return {
    skillId: skill.id,
    skillName: skill.name,
    skillPath: skill.path,
    contentHash: skill.contentHash,
    revision: Number(skill.revision || 1)
  }
}

function getAgentRun(runId) {
  const row = database.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId)
  if (!row) throw new Error('Agent 运行记录不存在')
  return {
    id: row.id,
    threadId: row.thread_id,
    requestId: row.request_id,
    projectId: row.project_id,
    providerId: row.provider_id,
    modelId: row.model_id,
    skillId: row.skill_id || '',
    agentRoute: row.agent_route || 'general',
    status: row.status,
    inputText: row.input_text,
    stepCount: row.step_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getPendingAgentApproval(projectId) {
  const run = database
    .prepare(
      `SELECT id FROM agent_runs
       WHERE project_id = ? AND status = 'awaiting_approval'
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(projectId)
  if (!run) return null
  const event = database
    .prepare(
      `SELECT payload_json FROM agent_events
       WHERE run_id = ? AND event_type = 'run.awaiting_approval'
       ORDER BY sequence DESC LIMIT 1`
    )
    .get(run.id)
  if (!event) return null
  const payload = parseJson(event.payload_json, {})
  if (payload.kind === 'node_selection') {
    return {
      runId: run.id,
      kind: payload.kind,
      query: payload.query,
      reason: payload.reason,
      candidates: payload.candidates || []
    }
  }
  return {
    runId: run.id,
    actionRequests: payload.actionRequests || payload.action_requests || [],
    reviewConfigs: payload.reviewConfigs || payload.review_configs || []
  }
}

function persistAgentEvent(event) {
  if (!event?.runId || !Number.isInteger(event.sequence)) return
  database
    .prepare(
      `INSERT OR IGNORE INTO agent_events(
        run_id, sequence, event_type, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(event.runId, event.sequence, event.type, JSON.stringify(event.payload || {}), now())
}

function listAgentEvents(runId) {
  return database
    .prepare(
      `SELECT sequence, event_type, payload_json, created_at
       FROM agent_events WHERE run_id = ? ORDER BY sequence ASC`
    )
    .all(runId)
    .map((row) => ({
      runId,
      sequence: row.sequence,
      type: row.event_type,
      payload: parseJson(row.payload_json, {}),
      createdAt: row.created_at
    }))
}

function createAgentDraft(args) {
  const project = getProject(args.context.projectId)
  const canvas = parseJson(project.canvasJson, { nodes: [], edges: [] })
  const operations = hydrateDraftGenerationSettings(
    reflowCreateNodeOperations(
      normalizeCanvasOperations(canvas, args.operations || []),
      canvas.nodes || []
    )
  )
  const id = `draft_${randomUUID()}`
  const timestamp = now()
  database
    .prepare(
      `INSERT INTO agent_drafts(
        id, run_id, project_id, expected_version, plan_json,
        operations_json, base_canvas_fingerprint, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`
    )
    .run(
      id,
      args.context.runId,
      project.id,
      project.version,
      JSON.stringify(args.plan || {}),
      JSON.stringify(operations),
      canvasFingerprint(project.canvasJson),
      timestamp,
      timestamp
    )
  return { id, expectedVersion: project.version, status: 'proposed' }
}

function getAgentDraft(draftId) {
  const row = database.prepare('SELECT * FROM agent_drafts WHERE id = ?').get(draftId)
  if (!row) throw new Error('画布草稿不存在')
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    expectedVersion: row.expected_version,
    plan: parseJson(row.plan_json, {}),
    operations: parseJson(row.operations_json, []),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getProposedAgentDraft(runId) {
  const row = database
    .prepare(
      `SELECT id FROM agent_drafts
       WHERE run_id = ? AND status = 'proposed'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(runId)
  return row ? getAgentDraft(row.id) : null
}

function rejectAgentDrafts(runId) {
  const changed = database
    .prepare(
      `UPDATE agent_drafts
       SET status = 'rejected', updated_at = ?
       WHERE run_id = ? AND status = 'proposed'`
    )
    .run(now(), runId).changes
  return { runId, rejectedDrafts: changed }
}

function commitAgentDraft(draftId) {
  const draft = database.prepare('SELECT * FROM agent_drafts WHERE id = ?').get(draftId)
  if (!draft) throw new Error('画布草稿不存在')
  if (draft.status === 'committed') return { draftId, status: 'committed' }
  const project = getProject(draft.project_id)
  let operations = parseJson(draft.operations_json, [])
  const canvas = parseJson(project.canvasJson, { nodes: [], edges: [] })
  const assessment = assertDraftCanApply(draft, project, operations)
  if (assessment.reason === 'additive_only') {
    operations = reflowCreateNodeOperations(operations, canvas.nodes || [])
  }
  const { canvas: nextCanvas, createdNodes } = applyCanvasOperations(canvas, operations)
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT OR REPLACE INTO agent_run_snapshots(
          run_id, project_id, canvas_json, viewport_json, canvas_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        draft.run_id,
        project.id,
        project.canvasJson,
        project.viewportJson,
        project.version,
        now()
      )
    const changed = database
      .prepare(
        `UPDATE projects
         SET canvas_json = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`
      )
      .run(JSON.stringify(nextCanvas), now(), project.id, project.version).changes
    if (!changed) throw new Error('CANVAS_VERSION_CONFLICT')
    database
      .prepare(
        "UPDATE agent_drafts SET operations_json = ?, status = 'committed', updated_at = ? WHERE id = ?"
      )
      .run(JSON.stringify(operations), now(), draftId)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return {
    draftId,
    status: 'committed',
    project: getProject(project.id),
    createdNodes: createdNodes.map(createdNodeRecord)
  }
}

function applyAndGenerateAgentDraft(draftId, promptEdits = []) {
  const draft = database.prepare('SELECT * FROM agent_drafts WHERE id = ?').get(draftId)
  if (!draft) throw new Error('画布草稿不存在')
  if (draft.status === 'committed') {
    return { draftId, status: 'committed', project: getProject(draft.project_id), tasks: [] }
  }
  const project = getProject(draft.project_id)
  const originalOperations = parseJson(draft.operations_json, [])
  const edits = Array.isArray(promptEdits) ? promptEdits : [promptEdits].filter(Boolean)
  let operations = applyDraftPromptEdits(originalOperations, edits)
  if (edits.length) {
    database
      .prepare('UPDATE agent_drafts SET operations_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(operations), now(), draftId)
  }
  const currentCanvas = parseJson(project.canvasJson, { nodes: [], edges: [] })
  const assessment = assertDraftCanApply(draft, project, operations)
  if (assessment.reason === 'additive_only') {
    operations = reflowCreateNodeOperations(operations, currentCanvas.nodes || [])
  }
  const {
    canvas: nextCanvas,
    createdNodes,
    updatedNodes
  } = applyCanvasOperations(currentCanvas, operations)
  const imageNodes = [...createdNodes, ...updatedNodes].filter(
    (node, index, items) =>
      node.type === 'image' && items.findIndex((candidate) => candidate.id === node.id) === index
  )
  const updatedNodeIds = new Set(updatedNodes.map((node) => node.id))
  const replacedTaskIds = [
    ...new Set(updatedNodes.map((node) => String(node.data?.taskId || '').trim()).filter(Boolean))
  ]
  const canceledTaskIds = []
  if (imageNodes.length > 12) throw new Error('单次最多提交 12 个图片生成任务')
  const timestamp = now()
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const pendingTasks = imageNodes.map((node) => {
    providerRuntime(node.data.providerId)
    const referenceAssetIds = imageReferenceAssetIds(nextCanvas, node.id, {
      includeTargetAsset: updatedNodeIds.has(node.id)
    })
    const requestJson = JSON.stringify(imageTaskRequest(node, referenceAssetIds))
    if (requestJson.length > 256 * 1024) throw new Error('任务请求超过 256KB')
    const id = `task_${randomUUID()}`
    Object.assign(node.data, {
      taskId: id,
      taskStatus: 'queued',
      taskProgress: 0,
      taskError: ''
    })
    return {
      id,
      projectId: project.id,
      nodeId: node.id,
      providerId: node.data.providerId,
      taskType: referenceAssetIds.length ? 'image.edit' : 'image.generate',
      requestJson
    }
  })

  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT OR REPLACE INTO agent_run_snapshots(
          run_id, project_id, canvas_json, viewport_json, canvas_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        draft.run_id,
        project.id,
        project.canvasJson,
        project.viewportJson,
        project.version,
        timestamp
      )
    const changed = database
      .prepare(
        `UPDATE projects
         SET canvas_json = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`
      )
      .run(JSON.stringify(nextCanvas), timestamp, project.id, project.version).changes
    if (!changed) throw new Error('CANVAS_VERSION_CONFLICT')
    const insertTask = database.prepare(
      `INSERT INTO tasks(
        id, project_id, node_id, provider_id, task_type, status, progress,
        request_json, result_json, deadline_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, '{}', ?, ?, ?)`
    )
    if (replacedTaskIds.length) {
      const cancelTask = database.prepare(
        `UPDATE tasks SET status = 'canceled', next_poll_at = NULL,
         error_message = '节点已提交新的生成任务', updated_at = ?
         WHERE id = ? AND status NOT IN ('completed', 'failed', 'canceled')`
      )
      for (const taskId of replacedTaskIds) {
        if (cancelTask.run(timestamp, taskId).changes) canceledTaskIds.push(taskId)
      }
    }
    for (const task of pendingTasks) {
      insertTask.run(
        task.id,
        task.projectId,
        task.nodeId,
        task.providerId,
        task.taskType,
        task.requestJson,
        deadline,
        timestamp,
        timestamp
      )
    }
    database
      .prepare(
        "UPDATE agent_drafts SET operations_json = ?, status = 'committed', updated_at = ? WHERE id = ?"
      )
      .run(JSON.stringify(operations), timestamp, draftId)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  for (const task of pendingTasks) {
    rpc.emit({ type: 'task.enqueued', taskId: task.id, projectId: project.id })
  }
  for (const taskId of canceledTaskIds) {
    rpc.emit({ type: 'task.canceled', taskId, projectId: project.id })
  }
  return {
    draftId,
    status: 'committed',
    project: getProject(project.id),
    createdNodes: createdNodes.map(createdNodeRecord),
    tasks: pendingTasks.map((task) =>
      taskRecord(database.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id))
    )
  }
}

function createdNodeRecord(node) {
  return {
    id: node.id,
    type: node.type,
    name: node.data?.name || '',
    prompt: node.data?.prompt || '',
    providerId: node.data?.providerId || '',
    model: node.data?.model || '',
    sizeSpecId: node.data?.sizeSpecId || '',
    ratio: node.data?.ratio || '',
    resolution: node.data?.resolution || '',
    requestSize: node.data?.requestSize || '',
    taskId: node.data?.taskId || '',
    taskStatus: node.data?.taskStatus || ''
  }
}

function assertDraftCanApply(draft, project, operations) {
  const assessment = assessCanvasDraftConflict({
    expectedVersion: draft.expected_version,
    currentVersion: project.version,
    baseCanvasFingerprint: draft.base_canvas_fingerprint,
    currentCanvasFingerprint: canvasFingerprint(project.canvasJson),
    operations
  })
  if (!assessment.canApply) {
    throw new Error('画布已在审批期间发生修改，请重新发送指令生成最新草稿')
  }
  return assessment
}

function canvasFingerprint(canvasJson) {
  const canvas = parseJson(canvasJson, { nodes: [], edges: [] })
  return createHash('sha256').update(stableJson(canvas)).digest('hex')
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function undoAgentRun(runId) {
  const snapshot = database.prepare('SELECT * FROM agent_run_snapshots WHERE run_id = ?').get(runId)
  if (!snapshot) throw new Error('该 Agent 运行没有可撤销的画布变更')
  const project = getProject(snapshot.project_id)
  return saveCanvas(project.id, snapshot.canvas_json, snapshot.viewport_json, project.version)
}

async function executeAgentTool(name, args, context) {
  if (name === 'canvas_get_snapshot') {
    const project = getProject(context.projectId)
    const canvas = parseJson(project.canvasJson, { nodes: [], edges: [] })
    return {
      projectId: project.id,
      name: project.name,
      version: project.version,
      viewport: parseJson(project.viewportJson, {}),
      nodeCount: (canvas.nodes || []).length,
      edgeCount: (canvas.edges || []).length,
      nodes: (canvas.nodes || []).slice(0, 60).map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        title: node.data?.title || node.data?.name || '',
        name: node.data?.name || node.data?.title || '',
        prompt: String(node.data?.prompt || '').slice(0, 260),
        assetId: node.data?.assetId || '',
        taskStatus: node.data?.taskStatus || ''
      })),
      edges: (canvas.edges || []).slice(0, 100).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target
      })),
      truncated: (canvas.nodes || []).length > 60 || (canvas.edges || []).length > 100
    }
  }
  if (name === 'canvas_find_nodes') {
    const project = getProject(context.projectId)
    const canvas = parseJson(project.canvasJson, { nodes: [], edges: [] })
    return findCanvasNodes(canvas, args.query)
  }
  if (name === 'human_select_node') {
    const selectedNodeId = String(args.selectedNodeId || '').trim()
    if (!selectedNodeId) throw new Error('尚未选择目标节点')
    const candidateIds = new Set((args.candidates || []).map((candidate) => candidate.id))
    if (!candidateIds.has(selectedNodeId)) throw new Error('所选节点不在候选列表中')
    const project = getProject(context.projectId)
    const canvas = parseJson(project.canvasJson, { nodes: [], edges: [] })
    const node = (canvas.nodes || []).find((item) => item.id === selectedNodeId)
    if (!node) throw new Error('所选节点已不存在，请重新读取画布')
    return {
      selectedNodeId: node.id,
      title: node.data?.title || node.data?.name || node.id,
      type: node.type,
      position: node.position
    }
  }
  if (name === 'models_list') {
    return listProviderProfiles()
      .filter((profile) => profile.enabled)
      .flatMap((profile) =>
        profile.models.map((model) => ({
          providerId: profile.id,
          providerName: profile.name,
          modelId: model.modelId,
          displayName: model.displayName,
          modelType: model.modelType,
          sizeSpecCount: model.sizeSpecs.length,
          sizeSpecs: model.sizeSpecs.slice(0, 12).map((spec) => ({
            id: spec.id,
            name: spec.name,
            ratio: spec.ratio,
            resolution: spec.resolution,
            requestSize: spec.requestSize
          }))
        }))
      )
  }
  if (name === 'assets_list') {
    const assets = listAssets(context.projectId)
    return {
      total: assets.length,
      items: assets.slice(0, 40).map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        createdAt: asset.createdAt
      })),
      truncated: assets.length > 40
    }
  }
  if (name === 'canvas_create_draft') {
    const draft = createAgentDraft({ ...args, context })
    rpc.emit({ type: 'agent.draft.created', runId: context.runId, draft })
    return draft
  }
  if (name === 'canvas_commit_draft') {
    const result = commitAgentDraft(args.draftId)
    rpc.emit({
      type: 'agent.canvas.committed',
      runId: context.runId,
      draftId: args.draftId,
      project: result.project
    })
    return result
  }
  if (name === 'canvas_apply_and_generate') {
    const result = applyAndGenerateAgentDraft(
      args.draftId,
      args.promptEdits || args.promptEdit || []
    )
    rpc.emit({
      type: 'agent.canvas.committed',
      runId: context.runId,
      draftId: args.draftId,
      project: result.project
    })
    return result
  }
  if (name === 'tasks_status') {
    const ids = new Set(args.taskIds || [])
    const tasks = listTasks(context.projectId)
    return ids.size ? tasks.filter((task) => ids.has(task.id)) : tasks
  }
  throw new Error(`Agent tool is not allowed: ${name}`)
}

function applyCanvasOperations(canvas, operations) {
  const next = structuredClone(canvas)
  next.nodes ||= []
  next.edges ||= []
  const references = new Map(next.nodes.map((node) => [node.id, node.id]))
  const createdNodes = []
  const updatedNodes = []
  for (const operation of operations.slice(0, 80)) {
    if (operation.op === 'createNode') {
      const id = `node_${randomUUID()}`
      const tempId = operation.tempId || id
      references.set(tempId, id)
      const type = ['image', 'video', 'audio', 'text', 'default'].includes(operation.kind)
        ? operation.kind
        : 'default'
      const name = uniqueCanvasNodeName(next.nodes, type, operation.name)
      const node = {
        id,
        type,
        position: {
          x: Number(operation.x || 0),
          y: Number(operation.y || 0)
        },
        data: {
          title: name.slice(0, 100),
          name: name.slice(0, 100),
          prompt: removeAppendedNegativePrompt(operation.prompt, operation.negativePrompt).slice(
            0,
            20000
          ),
          text: String(operation.text || '').slice(0, 20000),
          providerId: String(operation.providerId || ''),
          model: String(operation.model || ''),
          sizeSpecId: String(operation.sizeSpecId || ''),
          ratio: String(operation.ratio || ''),
          aspectRatio: String(operation.ratio || ''),
          resolution: String(operation.resolution || ''),
          requestSize: String(operation.requestSize || ''),
          taskId: '',
          taskStatus: 'idle',
          taskProgress: 0,
          taskError: ''
        }
      }
      next.nodes.push(node)
      createdNodes.push(node)
      continue
    }
    const nodeId = references.get(operation.nodeRef) || operation.nodeRef
    const node = next.nodes.find((item) => item.id === nodeId)
    if (operation.op === 'updateNode' && node) {
      const updates = operation.updates || {}
      node.data = { ...node.data }
      for (const key of [
        'name',
        'prompt',
        'text',
        'providerId',
        'model',
        'sizeSpecId',
        'ratio',
        'resolution',
        'requestSize'
      ]) {
        if (updates[key] !== undefined) {
          node.data[key] =
            key === 'prompt'
              ? removeAppendedNegativePrompt(updates[key], updates.negativePrompt)
              : String(updates[key])
          if (key === 'name') node.data.title = String(updates[key])
        }
      }
      delete node.data.negativePrompt
      updatedNodes.push(node)
    } else if (operation.op === 'moveNode' && node) {
      node.position = { x: Number(operation.x || 0), y: Number(operation.y || 0) }
    } else if (operation.op === 'deleteNode' && node) {
      next.nodes = next.nodes.filter((item) => item.id !== node.id)
      next.edges = next.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id)
    } else if (operation.op === 'connect') {
      const source = references.get(operation.sourceRef) || operation.sourceRef
      const target = references.get(operation.targetRef) || operation.targetRef
      const sourceNode = next.nodes.find((item) => item.id === source)
      const targetNode = next.nodes.find((item) => item.id === target)
      if (
        source !== target &&
        sourceNode &&
        targetNode &&
        canConnectCanvasNodes(sourceNode, targetNode) &&
        !next.edges.some((edge) => edge.source === source && edge.target === target)
      ) {
        next.edges.push({ id: `edge_${randomUUID()}`, source, target })
      }
    }
  }
  return { canvas: next, createdNodes, updatedNodes }
}

function removeAppendedNegativePrompt(prompt, negativePrompt) {
  const source = String(prompt || '')
  const negative = String(negativePrompt || '').trim()
  if (!negative) return source
  const suffix = `\n\n避免：${negative}`
  return source.endsWith(suffix) ? source.slice(0, -suffix.length).trimEnd() : source
}

function hydrateDraftGenerationSettings(operations) {
  const imageChoices = listProviderProfiles()
    .filter((profile) => profile.enabled)
    .flatMap((profile) =>
      profile.models
        .filter((model) => model.modelType === 'image')
        .map((model) => ({ provider: profile, model }))
    )
  return operations.map((operation) => {
    if (operation.op !== 'createNode' || operation.kind !== 'image') return operation
    const choice =
      imageChoices.find(
        (item) =>
          item.provider.id === operation.providerId && item.model.modelId === operation.model
      ) ||
      imageChoices.find((item) => item.model.modelId === operation.model) ||
      imageChoices[0]
    if (!choice) throw new Error('没有可用于角色图片生成的模型')
    const sizeSpecs = choice.model.sizeSpecs || []
    const sizeSpec =
      sizeSpecs.find((item) => item.id === operation.sizeSpecId) ||
      sizeSpecs.find(
        (item) => item.ratio === operation.ratio && item.resolution === operation.resolution
      ) ||
      sizeSpecs.find((item) => item.resolution === operation.resolution) ||
      sizeSpecs.find((item) => item.ratio === operation.ratio) ||
      sizeSpecs[0] ||
      {}
    return {
      ...operation,
      providerId: choice.provider.id,
      model: choice.model.modelId,
      sizeSpecId: sizeSpec.id || operation.sizeSpecId || '',
      ratio: sizeSpec.ratio || operation.ratio || '1:1',
      resolution: sizeSpec.resolution || operation.resolution || '1K',
      requestSize: sizeSpec.requestSize || operation.requestSize || sizeSpec.ratio || '1:1'
    }
  })
}

function loadCheckpointState() {
  const row = database.prepare('SELECT payload FROM agent_checkpoint_state WHERE id = 1').get()
  return row ? v8.deserialize(row.payload) : null
}

function saveCheckpointState(state) {
  database
    .prepare(
      `INSERT INTO agent_checkpoint_state(id, payload, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
    )
    .run(v8.serialize(state), now())
}

async function getStorageInfo() {
  return {
    appDataDir,
    projectCount: database
      .prepare('SELECT COUNT(*) AS count FROM projects WHERE deleted_at IS NULL')
      .get().count,
    assetCount: database.prepare('SELECT COUNT(*) AS count FROM assets').get().count,
    taskCount: database.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,
    totalBytes: await directorySize(appDataDir)
  }
}

function ensureProject(id) {
  const exists = database
    .prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(id)
  if (!exists) throw new Error('项目不存在')
}

function safeAppDataPath(relativePath) {
  const relative = String(relativePath || '').replaceAll('\\', '/')
  if (relative.startsWith('/') || relative.split('/').some((part) => !part || part === '..')) {
    throw new Error('本地路径无效')
  }
  const resolved = path.resolve(appDataDir, ...relative.split('/'))
  const root = `${path.resolve(appDataDir)}${path.sep}`.toLowerCase()
  if (!`${resolved}${path.sep}`.toLowerCase().startsWith(root)) throw new Error('本地路径越界')
  return resolved
}

function relativeAppPath(absolutePath) {
  const relative = path.relative(appDataDir, absolutePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('素材路径越界')
  return relative.replaceAll('\\', '/')
}

async function hashFile(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function mimeTypeForPath(filePath, kind) {
  const extension = path.extname(filePath).toLowerCase()
  const known = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4'
  }
  return known[extension] || `${kind}/octet-stream`
}

async function directorySize(directory) {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) total += await directorySize(target)
    else if (entry.isFile()) total += (await stat(target)).size
  }
  return total
}

function normalizeName(value, fallback) {
  return (
    String(value || '')
      .trim()
      .slice(0, 80) || fallback
  )
}

function parseJson(value, fallback, errorMessage = 'JSON 内容无效') {
  try {
    return JSON.parse(value)
  } catch {
    if (fallback !== null) return fallback
    throw new Error(errorMessage)
  }
}

function now() {
  return new Date().toISOString()
}
