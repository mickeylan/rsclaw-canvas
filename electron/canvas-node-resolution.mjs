import { canConnectCanvasNodes } from './canvas-generation.mjs'

export function findCanvasNodes(canvas, query, limit = 12) {
  const normalizedQuery = normalizeText(query).replace(/^@/, '')
  if (!normalizedQuery) return { status: 'not_found', query: '', candidates: [] }

  const candidates = (canvas.nodes || [])
    .map((node) => {
      const title = nodeTitle(node)
      const normalizedTitle = normalizeText(title)
      const normalizedId = normalizeText(node.id)
      let score = 0
      if (normalizedId === normalizedQuery) score = 120
      else if (normalizedTitle === normalizedQuery) score = 100
      else if (normalizedTitle.includes(normalizedQuery)) score = 80
      else if (normalizedQuery.includes(normalizedTitle) && normalizedTitle) score = 65
      return {
        id: node.id,
        title,
        type: node.type || 'default',
        position: node.position || { x: 0, y: 0 },
        promptPreview: String(node.data?.prompt || node.data?.text || '').slice(0, 180),
        score
      }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit)

  if (!candidates.length) return { status: 'not_found', query, candidates: [] }
  const topScore = candidates[0].score
  const topMatches = candidates.filter((item) => item.score === topScore)
  return {
    status: topMatches.length === 1 ? 'unique' : 'ambiguous',
    query,
    selectedNodeId: topMatches.length === 1 ? topMatches[0].id : null,
    candidates
  }
}

export function normalizeCanvasOperations(canvas, operations) {
  const nodes = canvas.nodes || []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const titleIndex = new Map()
  for (const node of nodes) {
    const title = normalizeText(nodeTitle(node))
    if (!title) continue
    const matches = titleIndex.get(title) || []
    matches.push(node.id)
    titleIndex.set(title, matches)
  }

  const temporaryIds = new Set()
  const temporaryKinds = new Map()
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const resolve = (reference, field) => {
    const value = String(reference || '').trim()
    if (!value) throw new Error(`画布操作缺少 ${field}`)
    if (nodeIds.has(value) || temporaryIds.has(value)) return value
    const matches = titleIndex.get(normalizeText(value)) || []
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      throw new Error(`节点标题“${value}”对应多个节点，请先让用户选择具体节点`)
    }
    throw new Error(`找不到节点“${value}”，请重新读取画布后再操作`)
  }

  return operations.map((operation, index) => {
    const normalized = structuredClone(operation)
    if (normalized.op === 'createNode') {
      const tempId = String(normalized.tempId || `draft_node_${index + 1}`)
      if (temporaryIds.has(tempId) || nodeIds.has(tempId)) {
        throw new Error(`草稿临时节点引用重复：${tempId}`)
      }
      normalized.tempId = tempId
      temporaryIds.add(tempId)
      temporaryKinds.set(tempId, normalized.kind || 'default')
      return normalized
    }
    if (['updateNode', 'moveNode', 'deleteNode'].includes(normalized.op)) {
      normalized.nodeRef = resolve(normalized.nodeRef, 'nodeRef')
      return normalized
    }
    if (normalized.op === 'connect') {
      normalized.sourceRef = resolve(normalized.sourceRef, 'sourceRef')
      normalized.targetRef = resolve(normalized.targetRef, 'targetRef')
      if (normalized.sourceRef === normalized.targetRef) {
        throw new Error('不能连接同一个节点')
      }
      const source =
        nodesById.get(normalized.sourceRef) ||
        (temporaryKinds.has(normalized.sourceRef)
          ? { id: normalized.sourceRef, type: temporaryKinds.get(normalized.sourceRef) }
          : null)
      const target =
        nodesById.get(normalized.targetRef) ||
        (temporaryKinds.has(normalized.targetRef)
          ? { id: normalized.targetRef, type: temporaryKinds.get(normalized.targetRef) }
          : null)
      if (!canConnectCanvasNodes(source, target)) {
        throw new Error('该节点类型组合不能建立有效的参考关系')
      }
      return normalized
    }
    throw new Error(`不支持的画布操作：${normalized.op}`)
  })
}

export function uniqueCanvasNodeName(nodes, kind, preferredName = '') {
  const existing = new Set(
    (Array.isArray(nodes) ? nodes : [])
      .map((node) => normalizeText(nodeTitle(node)))
      .filter(Boolean)
  )
  const preferred = String(preferredName || '').trim()
  if (preferred && !existing.has(normalizeText(preferred))) return preferred
  const base =
    preferred ||
    {
      image: '图片',
      video: '视频',
      audio: '音频'
    }[kind] ||
    '节点'
  let index = 1
  while (existing.has(normalizeText(`${base}${index}`))) index += 1
  return `${base}${index}`
}

function nodeTitle(node) {
  return String(node.data?.title || node.data?.name || node.id || '').trim()
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, '')
}
