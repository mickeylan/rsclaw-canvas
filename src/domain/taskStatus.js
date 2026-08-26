export const ACTIVE_TASK_STATUSES = new Set([
  'queued',
  'submitting',
  'submitted',
  'polling',
  'checking',
  'materializing',
  'materializing_active'
])

export const CANCELABLE_TASK_STATUSES = new Set([
  'queued',
  'submitting',
  'submitted',
  'polling',
  'checking'
])

const TASK_STATUS_LABELS = {
  queued: '已加入本地队列',
  submitting: '正在提交',
  submitted: '已提交',
  polling: '正在等待结果',
  checking: '正在检查结果',
  materializing: '准备保存到本机',
  materializing_active: '正在保存到本机',
  completed: '生成完成',
  failed: '生成失败',
  canceled: '已取消'
}

export function isTaskActive(status) {
  return ACTIVE_TASK_STATUSES.has(String(status || ''))
}

export function isTaskCancelable(status) {
  return CANCELABLE_TASK_STATUSES.has(String(status || ''))
}

export function taskStatusLabel(status) {
  return TASK_STATUS_LABELS[status] || '尚未运行'
}
