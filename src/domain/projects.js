export function filterAndSortProjects(projects = [], query = '', sortOrder = 'updated_desc') {
  const keyword = String(query).trim().toLocaleLowerCase()
  const filtered = keyword
    ? projects.filter((project) =>
        String(project.name || '')
          .toLocaleLowerCase()
          .includes(keyword)
      )
    : [...projects]
  return filtered.sort((left, right) => {
    if (sortOrder === 'created_asc') {
      return String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
    }
    if (sortOrder === 'name_asc') {
      return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
    }
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
  })
}

export function readProjectStats(project) {
  if (project?.stats && typeof project.stats === 'object') {
    return {
      image: Number(project.stats.image || 0),
      video: Number(project.stats.video || 0),
      audio: Number(project.stats.audio || 0),
      total: Number(project.stats.total || 0)
    }
  }
  let nodes
  try {
    const canvas = JSON.parse(project?.canvasJson || '{}')
    nodes = Array.isArray(canvas.nodes) ? canvas.nodes : []
  } catch {
    nodes = []
  }
  const stats = {
    image: 0,
    video: 0,
    audio: 0,
    total: 0
  }
  for (const node of nodes) {
    if (['image', 'video', 'audio'].includes(node?.type)) {
      stats[node.type] += 1
      stats.total += 1
    }
  }
  return stats
}

export function findProjectCoverAsset(project, assets = []) {
  let nodes
  try {
    const canvas = JSON.parse(project?.canvasJson || '{}')
    nodes = Array.isArray(canvas.nodes) ? canvas.nodes : []
  } catch {
    return null
  }

  const imageAssets = new Map(
    assets.filter((asset) => asset?.kind === 'image' && asset?.id).map((asset) => [asset.id, asset])
  )
  for (const node of nodes) {
    if (node?.type !== 'image') continue
    const asset = imageAssets.get(String(node?.data?.assetId || ''))
    if (asset) return asset
  }
  return null
}
