export function parseAssistantMessageActions(message) {
  const source = message?.actions ?? message?.actionsJson
  if (Array.isArray(source)) return source
  if (!source) return []
  try {
    const parsed = JSON.parse(source)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function assistantApprovalRecord(message) {
  return (
    parseAssistantMessageActions(message).find(
      (action) => action?.type === 'agent_approval' && action.runId
    ) || null
  )
}

export function assistantApprovalStatus(record) {
  const status = String(record?.status || 'pending')
  return (
    {
      pending: { label: '等待确认', symbol: '···' },
      approved: { label: '已确认', symbol: '✓' },
      rejected: { label: '已取消', symbol: '×' },
      superseded: { label: '已更新', symbol: '↻' },
      failed: { label: '执行失败', symbol: '!' }
    }[status] || { label: status, symbol: '·' }
  )
}

export function assistantApprovalItems(record) {
  return Array.isArray(record?.items) ? record.items : []
}
