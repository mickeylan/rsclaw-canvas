function uid(prefix) {
  return `${prefix}_${crypto.randomUUID()}`
}

const supportedCanvasActionTypes = new Set([
  'create_node',
  'create_storyboard',
  'update_node',
  'move_node',
  'delete_node',
  'generate_node',
  'connect_nodes',
  'disconnect_nodes'
])

export function isSupportedCanvasAction(action) {
  return supportedCanvasActionTypes.has(String(action?.type || '').trim())
}

export function resolveCanvasNode(nodes, nodeRef) {
  const ref = String(nodeRef || '')
    .trim()
    .toLowerCase()
  if (!ref) return null
  return (
    nodes.find((node) => String(node.id).toLowerCase() === ref) ||
    nodes.find((node) => nodeName(node).toLowerCase() === ref) ||
    null
  )
}

export function nodeName(node) {
  return String(node?.data?.name || node?.data?.title || node?.id || '').trim()
}

export function stripImagePromptSizeInstructions(value) {
  return String(value || '')
    .replace(/\[\s*(?:ratio|aspect\s*ratio|resolution|size)\s*[:=]\s*[^\]]+\]/gi, '')
    .replace(
      /(?:画面比例|图片比例|宽高比|长宽比|尺寸比例|比例|aspect\s*ratio)\s*[:：为=]?\s*\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?/gi,
      ''
    )
    .replace(
      /(?:图片尺寸|画布尺寸|输出尺寸|像素尺寸|分辨率|resolution|image\s*size)\s*[:：为=]?\s*(?:\d+\s*[x×]\s*\d+|\d+\s*k)\b/gi,
      ''
    )
    .replace(
      /(?:采用|使用|按照|以)?\s*\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?\s*(?:画幅|比例|构图)/gi,
      ''
    )
    .replace(/[，,；;]\s*(?=[，,；;。]|$)/g, '')
    .replace(/[，,；;。]{2,}/g, (marks) => (marks.includes('。') ? '。' : '，'))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，,；;。])/g, '$1')
    .trim()
}

export function buildCanvasContext(nodes, edges, options = {}) {
  return {
    defaultImageModel: options.defaultImageModel || null,
    availableImageModels: Array.isArray(options.imageModels) ? options.imageModels : [],
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.type,
      name: nodeName(node),
      prompt: String(node.data?.prompt || '').slice(0, 260),
      providerId: String(node.data?.providerId || ''),
      model: String(node.data?.model || ''),
      sizeSpecId: String(node.data?.sizeSpecId || ''),
      ratio: String(node.data?.ratio || node.data?.aspectRatio || ''),
      resolution: String(node.data?.resolution || ''),
      hasResult: Boolean(node.data?.assetId || node.data?.result),
      position: {
        x: Number(node.position?.x || 0),
        y: Number(node.position?.y || 0)
      }
    })),
    edges: edges.map((edge) => ({
      source: edge.source,
      target: edge.target
    }))
  }
}

export function sanitizeMediaCanvas(graph = {}) {
  const sourceNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const sourceEdges = Array.isArray(graph.edges) ? graph.edges : []
  let removedSkillBindings = false
  const nodes = sourceNodes
    .filter((node) => ['image', 'video', 'audio'].includes(node?.type))
    .map((node) => {
      const data = { ...(node.data || {}) }
      let nodeHadSkillBinding = false
      for (const key of ['skillId', 'skillCode', 'skillName', 'skillGuide']) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) continue
        delete data[key]
        nodeHadSkillBinding = true
        removedSkillBindings = true
      }
      return nodeHadSkillBinding ? { ...node, data } : node
    })
  const nodeIds = new Set(nodes.map((node) => node.id))
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const edges = sourceEdges.filter(
    (edge) =>
      nodeIds.has(edge.source) &&
      nodeIds.has(edge.target) &&
      canUseNodeAsReference(nodesById.get(edge.source), nodesById.get(edge.target))
  )
  return {
    nodes,
    edges,
    removed:
      nodes.length !== sourceNodes.length ||
      edges.length !== sourceEdges.length ||
      removedSkillBindings
  }
}

export function incomingReferenceAssetIds(nodes, edges, targetNodeId) {
  return incomingReferenceNodes(nodes, edges, targetNodeId)
    .map((node) => String(node.data?.assetId || '').trim())
    .filter(Boolean)
}

export function incomingReferenceNodes(nodes, edges, targetNodeId) {
  const nodeById = new Map(
    (Array.isArray(nodes) ? nodes : []).filter((node) => node?.id).map((node) => [node.id, node])
  )
  const seenNodeIds = new Set()
  const seenAssetIds = new Set()
  const references = []

  for (const edge of Array.isArray(edges) ? edges : []) {
    if (edge?.target !== targetNodeId) continue
    const sourceId = String(edge?.source || '').trim()
    if (!sourceId || seenNodeIds.has(sourceId)) continue
    const node = nodeById.get(sourceId)
    if (!node) continue
    const assetId = String(node.data?.assetId || '').trim()
    if (assetId && seenAssetIds.has(assetId)) continue
    seenNodeIds.add(sourceId)
    if (assetId) seenAssetIds.add(assetId)
    references.push(node)
  }

  return references
}

export function mediaNodeKind(node) {
  const kind = String(node?.type || node?.data?.kind || node?.data?.assetKind || '')
    .trim()
    .toLowerCase()
  return ['image', 'video', 'audio'].includes(kind) ? kind : ''
}

export function canUseNodeAsReference(sourceNode, targetNode) {
  const sourceKind = mediaNodeKind(sourceNode)
  const targetKind = mediaNodeKind(targetNode)
  if (targetKind === 'image') return sourceKind === 'image'
  if (targetKind === 'video') {
    return ['image', 'video', 'audio'].includes(sourceKind)
  }
  return false
}

export function mentionedReferenceAssetIds(nodes, targetNode) {
  const prompt = String(targetNode?.data?.prompt || '').toLowerCase()
  if (!prompt) return []
  const seen = new Set()
  return nodes
    .filter((node) => node.id !== targetNode?.id)
    .filter((node) => canUseNodeAsReference(node, targetNode))
    .filter((node) => {
      const name = nodeName(node).toLowerCase()
      return name && prompt.includes(`@${name}`)
    })
    .map((node) => String(node.data?.assetId || '').trim())
    .filter((assetId) => {
      if (!assetId || seen.has(assetId)) return false
      seen.add(assetId)
      return true
    })
}

export function referenceAssetIdsForNode(nodes, edges, targetNode) {
  const connectedAssetIds = incomingReferenceNodes(nodes, edges, targetNode?.id)
    .filter((node) => canUseNodeAsReference(node, targetNode))
    .map((node) => String(node.data?.assetId || '').trim())
    .filter(Boolean)
  return [...new Set([...connectedAssetIds, ...mentionedReferenceAssetIds(nodes, targetNode)])]
}

export function applyCanvasAction(graph, action, options = {}) {
  const nodes = graph.nodes
  const edges = graph.edges
  const type = String(action?.type || '').trim()
  if (!type) return { changed: false }

  if (type === 'create_node') {
    const node = createActionNode(nodes, action, options)
    nodes.push(node)
    return { changed: true, node }
  }
  if (type === 'create_storyboard') {
    const scenes = Array.isArray(action.scenes) ? action.scenes.slice(0, 24) : []
    const layoutItems = scenes.map((scene) => ({
      ...scene,
      ratio: scene.ratio || action.ratio
    }))
    const positions = options.position
      ? canvasGridPositionsFrom(Number(options.position.x), Number(options.position.y), layoutItems)
      : nextCanvasGridPositions(nodes, layoutItems)
    const created = scenes.map((scene, index) =>
      createActionNode(
        nodes,
        {
          ...scene,
          kind: action.kind || 'image',
          ratio: scene.ratio || action.ratio,
          sizeSpecId: scene.sizeSpecId || action.sizeSpecId
        },
        {
          ...options,
          position: positions[index]
        }
      )
    )
    nodes.push(...created)
    if (action.autoConnect === true) {
      for (let index = 1; index < created.length; index += 1) {
        edges.push(createEdge(created[index - 1].id, created[index].id))
      }
    }
    return { changed: created.length > 0, nodes: created }
  }

  const node = resolveCanvasNode(nodes, action.nodeRef)
  if (type === 'update_node' && node) {
    const updates = action.updates && typeof action.updates === 'object' ? action.updates : {}
    if (updates.name !== undefined) {
      node.data.title = String(updates.name || '').trim() || node.data.title
      node.data.name = node.data.title
    }
    if (updates.sizeSpecId !== undefined && typeof options.resolveSizeSpec === 'function') {
      const sizeSpec = options.resolveSizeSpec(node, updates.sizeSpecId)
      if (sizeSpec) Object.assign(node.data, sizeSpec)
    }
    for (const key of [
      'prompt',
      'ratio',
      'aspectRatio',
      'resolution',
      'duration',
      'voiceId',
      'speed',
      'format'
    ]) {
      if (updates[key] !== undefined) {
        node.data[key] =
          key === 'prompt' && node.type === 'image'
            ? stripImagePromptSizeInstructions(updates[key])
            : updates[key]
      }
    }
    return { changed: true, node }
  }
  if (type === 'move_node' && node) {
    node.position = {
      x: Number(action.x || 0),
      y: Number(action.y || 0)
    }
    return { changed: true, node }
  }
  if (type === 'delete_node' && node) {
    graph.nodes.splice(graph.nodes.indexOf(node), 1)
    graph.edges = graph.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id)
    return { changed: true, node }
  }
  if (type === 'generate_node') {
    return node
      ? { changed: false, generateNodeId: node.id }
      : { changed: false, error: '生成目标节点不存在' }
  }
  if (type === 'connect_nodes' || type === 'disconnect_nodes') {
    const source = resolveCanvasNode(nodes, action.sourceRef)
    const target = resolveCanvasNode(nodes, action.targetRef)
    if (!source || !target || source.id === target.id) {
      return { changed: false, error: '连线节点不存在' }
    }
    if (!canUseNodeAsReference(source, target)) {
      return { changed: false, error: '该节点类型组合不能建立有效的参考关系' }
    }
    const index = edges.findIndex((edge) => edge.source === source.id && edge.target === target.id)
    if (type === 'disconnect_nodes') {
      if (index < 0) return { changed: false }
      edges.splice(index, 1)
      return { changed: true }
    }
    if (index >= 0) return { changed: false }
    const edge = createEdge(source.id, target.id)
    edges.push(edge)
    return { changed: true, edge }
  }
  return { changed: false, error: `不支持的画布动作：${type}` }
}

function createActionNode(existingNodes, action, options) {
  const kind = ['image', 'video', 'audio'].includes(action.kind) ? action.kind : 'image'
  const defaults = options.defaults?.(kind, action) || {}
  const position = options.position || nextCanvasGridPositions(existingNodes, [action])[0]
  const name = uniqueActionNodeName(existingNodes, kind, action.name)
  return {
    id: uid('node'),
    type: kind,
    position: { x: Number(position.x), y: Number(position.y) },
    data: {
      ...defaults,
      title: name,
      name,
      prompt:
        kind === 'image'
          ? stripImagePromptSizeInstructions(action.prompt)
          : String(action.prompt || ''),
      ...(action.ratio && !(kind === 'image' && defaults.sizeSpecId)
        ? kind === 'image'
          ? { ratio: action.ratio, aspectRatio: action.ratio }
          : { ratio: action.ratio }
        : {})
    }
  }
}

function createEdge(source, target) {
  return {
    id: uid('edge'),
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    type: 'default'
  }
}

function uniqueActionNodeName(nodes, kind, preferredName) {
  const existing = new Set(nodes.map((node) => nodeName(node).toLocaleLowerCase()).filter(Boolean))
  const preferred = String(preferredName || '').trim()
  if (preferred && !existing.has(preferred.toLocaleLowerCase())) return preferred
  const base = preferred || { image: '图片', video: '视频', audio: '音频' }[kind] || '节点'
  let index = 1
  while (existing.has(`${base}${index}`.toLocaleLowerCase())) index += 1
  return `${base}${index}`
}

function nextCanvasGridPositions(nodes, items) {
  const existing = nodes.filter((node) => node?.position)
  const startX = existing.length
    ? snapCanvasGrid(Math.min(...existing.map((node) => Number(node.position.x || 0))))
    : 160
  const startY = existing.length
    ? Math.max(
        ...existing.map((node) => Number(node.position.y || 0) + estimatedCanvasNodeHeight(node))
      ) + CANVAS_NODE_GAP
    : 160
  return canvasGridPositionsFrom(startX, startY, items)
}

function canvasGridPositionsFrom(startX, startY, items) {
  let rowY = startY
  const positions = []
  for (let index = 0; index < items.length; index += CANVAS_GRID_COLUMNS) {
    const row = items.slice(index, index + CANVAS_GRID_COLUMNS)
    row.forEach((_item, column) => {
      positions.push({
        x: startX + column * CANVAS_COLUMN_STEP,
        y: roundCanvasCoordinate(rowY)
      })
    })
    rowY += Math.max(...row.map(estimatedCanvasNodeHeight), DEFAULT_NODE_HEIGHT) + CANVAS_NODE_GAP
  }
  return positions
}

const CANVAS_GRID_COLUMNS = 3
const CANVAS_NODE_WIDTH = 320
const CANVAS_NODE_GAP = 2
const CANVAS_COLUMN_STEP = CANVAS_NODE_WIDTH + CANVAS_NODE_GAP
const CANVAS_TITLE_BLOCK_HEIGHT = 22
const DEFAULT_NODE_HEIGHT = CANVAS_NODE_WIDTH + CANVAS_TITLE_BLOCK_HEIGHT

function estimatedCanvasNodeHeight(node) {
  const ratio = String(
    node?.ratio || node?.aspectRatio || node?.data?.ratio || node?.data?.aspectRatio || '1:1'
  )
  const match = ratio.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  const width = Number(match?.[1] || 1)
  const height = Number(match?.[2] || 1)
  const previewHeight =
    width > 0 && height > 0 ? (CANVAS_NODE_WIDTH * height) / width : CANVAS_NODE_WIDTH
  return CANVAS_TITLE_BLOCK_HEIGHT + previewHeight
}

function snapCanvasGrid(value) {
  return Math.round(Number(value || 0) / 20) * 20
}

function roundCanvasCoordinate(value) {
  return Number(Number(value || 0).toFixed(3))
}
