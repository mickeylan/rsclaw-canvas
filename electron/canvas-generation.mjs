export function canConnectCanvasNodes(source, target) {
  const sourceKind = canvasNodeKind(source)
  const targetKind = canvasNodeKind(target)
  if (targetKind === 'image') return sourceKind === 'image'
  if (targetKind === 'video') return ['image', 'video', 'audio'].includes(sourceKind)
  return false
}

export function imageReferenceAssetIds(canvas, nodeId, { includeTargetAsset = false } = {}) {
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : []
  const edges = Array.isArray(canvas?.edges) ? canvas.edges : []
  const target = nodes.find((node) => node.id === nodeId)
  if (!target || canvasNodeKind(target) !== 'image') return []

  const ids = []
  if (includeTargetAsset) {
    const targetAssetId = String(target.data?.assetId || '').trim()
    if (targetAssetId) ids.push(targetAssetId)
  }
  for (const edge of edges) {
    if (edge?.target !== nodeId) continue
    const source = nodes.find((node) => node.id === edge.source)
    if (!source || !canConnectCanvasNodes(source, target)) continue
    const assetId = String(source.data?.assetId || '').trim()
    if (assetId) ids.push(assetId)
  }
  return [...new Set(ids)].slice(0, 8)
}

export function imageTaskRequest(node, referenceAssetIds = []) {
  const request = {
    prompt: String(node?.data?.prompt || ''),
    model: String(node?.data?.model || ''),
    aspectRatio: node?.data?.requestSize || node?.data?.ratio || '1:1',
    ratio: node?.data?.ratio || '1:1',
    resolution: node?.data?.resolution || '1K',
    sizeSpecId: node?.data?.sizeSpecId || '',
    requestSize: node?.data?.requestSize || node?.data?.ratio || '1:1'
  }
  if (referenceAssetIds.length) request.referenceAssetIds = referenceAssetIds
  return request
}

function canvasNodeKind(node) {
  return String(node?.type || node?.data?.kind || '')
    .trim()
    .toLowerCase()
}
