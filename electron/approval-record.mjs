export function approvalRecordItems(operations) {
  return (Array.isArray(operations) ? operations : [])
    .map((operation, operationIndex) => {
      if (operation.op === 'createNode') {
        return {
          operationIndex,
          operation: 'create',
          kind: operation.kind || 'default',
          name: operation.name || operation.tempId || `节点 ${operationIndex + 1}`,
          prompt: String(operation.prompt || operation.text || '').slice(0, 20000)
        }
      }
      if (operation.op === 'updateNode') {
        return {
          operationIndex,
          operation: 'update',
          kind: operation.kind || 'default',
          name: operation.updates?.name || operation.nodeRef || `节点 ${operationIndex + 1}`,
          prompt: String(operation.updates?.prompt || operation.updates?.text || '').slice(0, 20000)
        }
      }
      if (operation.op === 'moveNode') {
        return {
          operationIndex,
          operation: 'move',
          kind: 'default',
          name: operation.nodeRef || `节点 ${operationIndex + 1}`,
          detail: `移动到 (${Math.round(Number(operation.x || 0))}, ${Math.round(Number(operation.y || 0))})`
        }
      }
      if (operation.op === 'deleteNode') {
        return {
          operationIndex,
          operation: 'delete',
          kind: 'default',
          name: operation.nodeRef || `节点 ${operationIndex + 1}`,
          detail: '删除该节点及其相关连线',
          destructive: true
        }
      }
      if (operation.op === 'connect') {
        return {
          operationIndex,
          operation: 'connect',
          kind: 'default',
          name: `${operation.sourceRef || '来源节点'} → ${operation.targetRef || '目标节点'}`,
          detail: '建立参考关系'
        }
      }
      return null
    })
    .filter(Boolean)
}
