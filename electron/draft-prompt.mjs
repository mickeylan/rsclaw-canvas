export function applyDraftPromptEdit(operations, edit) {
  const prompt = String(edit?.prompt || '').trim()
  const operationIndex = Number(edit?.operationIndex)
  if (!prompt) throw new Error('AI 绘画提示词不能为空')
  if (prompt.length > 20000) throw new Error('AI 绘画提示词不能超过 20000 个字符')
  if (
    !Number.isInteger(operationIndex) ||
    operationIndex < 0 ||
    operationIndex >= operations.length
  ) {
    throw new Error('待编辑的图片生成操作不存在')
  }

  const nextOperations = structuredClone(operations)
  const operation = nextOperations[operationIndex]
  if (operation.op === 'createNode' && operation.kind === 'image') {
    operation.prompt = prompt
    return nextOperations
  }
  if (operation.op === 'updateNode' && operation.updates?.prompt !== undefined) {
    operation.updates.prompt = prompt
    return nextOperations
  }
  throw new Error('待编辑的操作不会生成图片')
}

export function applyDraftPromptEdits(operations, edits) {
  return (Array.isArray(edits) ? edits : [edits].filter(Boolean)).reduce(
    (current, edit) => applyDraftPromptEdit(current, edit),
    operations
  )
}
