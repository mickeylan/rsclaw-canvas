export function nodeMentionOptions(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      const value = String(node?.data?.title || node?.data?.name || node?.id || '').trim()
      const kind = String(node?.type || '').trim()
      return {
        value,
        label: value,
        nodeId: String(node?.id || '').trim(),
        kind,
        kindLabel:
          {
            image: '图片',
            video: '视频',
            audio: '音频'
          }[kind] || '节点',
        description: String(node?.data?.prompt || '')
          .trim()
          .slice(0, 80)
      }
    })
    .filter((option) => option.value && option.nodeId)
}

export function filterNodeMention(search, option) {
  const query = String(search || '')
    .trim()
    .toLowerCase()
  if (!query) return true
  return [option?.label, option?.description, option?.nodeId, option?.kindLabel].some((value) =>
    String(value || '')
      .toLowerCase()
      .includes(query)
  )
}

export function assistantInputKeyAction(event) {
  if (event?.key === 'Enter') {
    if (event.defaultPrevented || event.shiftKey || event.isComposing || event.target?.composing) {
      return null
    }
    return 'send'
  }
  return null
}
