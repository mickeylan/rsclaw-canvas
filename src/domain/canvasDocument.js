export function cloneCanvasNode(node, id, offset = { x: 40, y: 40 }) {
  if (!node?.id || !id) throw new Error('无法复制无效节点')
  const data = JSON.parse(JSON.stringify(node.data || {}))
  resetCopiedTaskState(data)
  return {
    id,
    type: node.type || 'image',
    position: {
      x: Number(node.position?.x || 0) + Number(offset.x || 0),
      y: Number(node.position?.y || 0) + Number(offset.y || 0)
    },
    data
  }
}

export function uniqueCanvasNodeName(nodes, kind, preferredName = '') {
  const existingNames = new Set(
    (Array.isArray(nodes) ? nodes : [])
      .map((node) =>
        String(node?.data?.title || node?.data?.name || '')
          .trim()
          .toLocaleLowerCase()
      )
      .filter(Boolean)
  )
  const preferred = String(preferredName || '').trim()
  if (preferred && !existingNames.has(preferred.toLocaleLowerCase())) return preferred

  const base =
    preferred ||
    {
      image: '图片',
      video: '视频',
      audio: '音频'
    }[kind] ||
    '节点'
  let index = 1
  while (existingNames.has(`${base}${index}`.toLocaleLowerCase())) index += 1
  return `${base}${index}`
}

export function resetCopiedTaskState(data) {
  const keys = ['taskId', 'taskStatus', 'taskProgress', 'taskError']
  if (!keys.some((key) => Object.hasOwn(data, key))) return data
  const hasResult =
    Boolean(String(data.assetId || '').trim()) || Boolean(String(data.result || '').trim())
  data.taskId = ''
  data.taskStatus = hasResult ? 'completed' : 'idle'
  data.taskProgress = hasResult ? 100 : 0
  data.taskError = ''
  return data
}

export function isTextEditingTarget(target) {
  if (!target || typeof target !== 'object') return false
  const tagName = String(target.tagName || '').toLowerCase()
  return ['input', 'textarea', 'select'].includes(tagName) || Boolean(target.isContentEditable)
}
