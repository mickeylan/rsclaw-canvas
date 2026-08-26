export const RENDERER_CORE_COMMANDS = new Set([
  'list_projects',
  'create_project',
  'get_project',
  'rename_project',
  'duplicate_project',
  'delete_project',
  'list_deleted_projects',
  'restore_project',
  'save_canvas',
  'list_project_backups',
  'restore_project_backup',
  'export_project',
  'import_project',
  'list_provider_profiles',
  'delete_provider_profile',
  'list_assets',
  'import_asset',
  'export_asset',
  'list_tasks',
  'enqueue_task',
  'cancel_task',
  'retry_task',
  'list_canvas_skills',
  'get_custom_skill_detail',
  'save_custom_skill',
  'delete_custom_skill',
  'list_assistant_messages',
  'clear_assistant_messages',
  'get_pending_agent_approval',
  'get_agent_draft'
])

export function isRendererCoreCommand(command) {
  return RENDERER_CORE_COMMANDS.has(command)
}

export function canEditSystemSkills({ isPackaged, environment = process.env } = {}) {
  return !isPackaged && environment.LUMX_SYSTEM_SKILL_DEV === '1'
}
