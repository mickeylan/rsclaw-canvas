const AGENT_LABELS = {
  orchestrator: {
    started: '正在理解你的需求',
    startedDetail: '正在确认你想要的结果，并安排接下来的操作',
    completed: '已理解你的需求',
    failed: '理解需求时遇到问题'
  },
  'role-design-agent': {
    started: '正在设计角色形象',
    startedDetail: '正在整理角色的外貌、服装和用于生成图片的描述',
    completed: '角色设计已经准备好',
    failed: '设计角色时遇到问题'
  },
  'visual-design-agent': {
    started: '正在设计画面',
    startedDetail: '正在整理构图、风格和用于生成图片的描述',
    completed: '画面设计已经准备好',
    failed: '设计画面时遇到问题'
  }
}

const TOOL_LABELS = {
  canvas_get_snapshot: {
    started: '正在查看当前画布',
    detail: '读取已有内容，避免重复创建或操作错对象',
    completed: '已读取当前画布'
  },
  canvas_find_nodes: {
    started: '正在查找你提到的内容',
    detail: '根据名称在画布中确认要操作的内容',
    completed: '已找到相关画布内容'
  },
  models_list: {
    started: '正在确认可用的图片模型',
    detail: '检查模型和清晰度，确保图片可以正常生成',
    completed: '已确认可用的图片模型'
  },
  assets_list: {
    started: '正在查看可用素材',
    detail: '检查当前项目中是否有可以复用的图片或视频',
    completed: '已检查项目素材'
  },
  tasks_status: {
    started: '正在查看生成进度',
    detail: '确认图片或视频是否已经生成完成',
    completed: '已更新生成进度'
  },
  canvas_create_draft: {
    started: '正在整理画布操作',
    detail: '先准备好将要创建或修改的内容，确认后再执行',
    completed: '画布操作已经准备好'
  },
  canvas_commit_draft: {
    started: '正在更新画布',
    detail: '正在应用你刚刚确认的修改',
    completed: '画布已经更新'
  },
  canvas_apply_and_generate: {
    started: '正在创建内容并提交图片生成',
    detail: '先把内容放到画布，再交给图片模型生成',
    completed: '内容已创建，图片正在生成'
  },
  human_select_node: {
    started: '需要你选择要操作的内容',
    detail: '画布中有多个相似内容，请确认具体目标',
    completed: '已收到你的选择'
  }
}

function activityId(event) {
  const payload = event?.payload || {}
  return (
    payload.invocationId ||
    `${event?.type || 'event'}_${event?.sequence || event?.timestamp || Date.now()}`
  )
}

function contextualToolLabel(name, phase, args = {}) {
  const labels = TOOL_LABELS[name] || {
    started: '正在处理你的请求',
    detail: '正在完成这一步操作',
    completed: '这一步已经处理完成'
  }
  if (name === 'canvas_find_nodes' && args.query) {
    const query = String(args.query).slice(0, 30)
    return {
      label: phase === 'started' ? `正在画布中查找“${query}”` : `已找到“${query}”的相关内容`,
      detail: labels.detail
    }
  }
  return {
    label: labels[phase],
    detail: phase === 'started' ? labels.detail : ''
  }
}

function descriptor(event) {
  const type = event?.type
  const payload = event?.payload || {}
  if (type === 'run.started') {
    return {
      id: `run_${event.runId || activityId(event)}`,
      kind: 'run',
      label: '正在准备这次任务',
      detail: '我会先理解你的需求，再根据需要查看画布和生成内容',
      completedLabel: '已开始处理你的请求',
      status: 'running'
    }
  }
  if (type === 'run.resumed') {
    return {
      id: `resume_${event.runId || activityId(event)}`,
      kind: 'run',
      label: '已收到你的确认，正在继续执行',
      detail: '正在完成你刚刚确认的画布操作',
      completedLabel: '已根据你的确认继续执行',
      status: 'running'
    }
  }
  if (type === 'skill.activated' || type === 'skill.matched') {
    return {
      id: `skill_${event.runId || activityId(event)}`,
      kind: 'skill',
      label: `已自动应用 Skill：${String(payload.skillName || '创作规则').slice(0, 80)}`,
      detail: '会根据这项创作规则完成本次请求',
      status: 'completed'
    }
  }
  if (type === 'agent.started') {
    const labels = AGENT_LABELS[payload.agentRole] || {
      started: '专业 Agent 正在执行任务'
    }
    return {
      id: activityId(event),
      kind: 'agent',
      label: labels.started,
      detail: labels.startedDetail || '正在准备适合本次任务的内容',
      completedLabel: labels.completed || '内容已经准备好',
      status: 'running'
    }
  }
  if (type === 'agent.completed' || type === 'agent.failed') {
    const phase = type.endsWith('completed') ? 'completed' : 'failed'
    const labels = AGENT_LABELS[payload.agentRole] || {
      completed: '专业 Agent 已完成任务',
      failed: '专业 Agent 执行失败'
    }
    return {
      id: activityId(event),
      kind: 'agent',
      label: labels[phase],
      detail: phase === 'failed' ? '你可以稍后重试，或换一种说法重新描述需求' : '',
      status: phase
    }
  }
  if (type === 'agent.reused') {
    const labels = AGENT_LABELS[payload.agentRole]
    return {
      id: activityId(event),
      kind: 'agent',
      label: labels ? `${labels.completed}，继续使用本次结果` : '已继续使用刚刚准备好的内容',
      status: 'completed'
    }
  }
  if (type === 'tool.started') {
    const copy = contextualToolLabel(payload.name, 'started', payload.args)
    return {
      id: activityId(event),
      kind: 'tool',
      label: copy.label,
      detail: copy.detail,
      completedLabel: contextualToolLabel(payload.name, 'completed').label,
      status: 'running'
    }
  }
  if (type === 'tool.completed' || type === 'tool.failed' || type === 'tool.awaiting_user') {
    const status =
      type === 'tool.completed' ? 'completed' : type === 'tool.failed' ? 'failed' : 'paused'
    const toolCopy = TOOL_LABELS[payload.name]
    const completedCopy = contextualToolLabel(payload.name, 'completed')
    const label =
      status === 'completed'
        ? completedCopy.label
        : status === 'paused'
          ? '准备工作已完成，请确认后继续'
          : `${String(toolCopy?.started || '处理这一步操作').replace(/^正在/, '')}时遇到问题`
    const detail =
      status === 'paused'
        ? '确认前不会修改画布或提交生成任务'
        : status === 'failed'
          ? '你可以稍后重试，或检查模型和供应商设置'
          : ''
    return { id: activityId(event), kind: 'tool', label, detail, status }
  }
  return null
}

function finishRunning(items, status) {
  return items.map((item) =>
    item.status === 'running'
      ? {
          ...item,
          label: status === 'completed' && item.completedLabel ? item.completedLabel : item.label,
          detail: '',
          status
        }
      : item
  )
}

export function reduceAssistantActivities(current, event, maximum = 10) {
  let items = Array.isArray(current) ? [...current] : []
  if (event?.type === 'run.awaiting_approval') {
    items = finishRunning(items, 'paused')
    items.push({
      id: `approval_${event.runId || activityId(event)}`,
      kind: 'run',
      label: '准备工作已完成，请确认后继续',
      detail: '确认前不会修改画布或提交生成任务',
      status: 'paused'
    })
    return items.slice(-maximum)
  }
  if (event?.type === 'run.completed') {
    items = finishRunning(items, 'completed')
    items.push({
      id: `complete_${event.runId || activityId(event)}`,
      kind: 'run',
      label: '这次操作已经完成',
      status: 'completed'
    })
    return items.slice(-maximum)
  }
  if (event?.type === 'run.failed' || event?.type === 'run.canceled') {
    items = finishRunning(items, 'failed')
    items.push({
      id: `${event.type}_${event.runId || activityId(event)}`,
      kind: 'run',
      label: event.type === 'run.canceled' ? '这次操作已停止' : '这次操作没有完成',
      detail: event.type === 'run.failed' ? '请稍后重试，或换一种说法重新描述需求' : '',
      status: 'failed'
    })
    return items.slice(-maximum)
  }
  const next = descriptor(event)
  if (!next) return items
  if (next.kind === 'agent' || next.kind === 'tool') {
    items = items.map((item) =>
      item.kind === 'run' && item.status === 'running' ? { ...item, status: 'completed' } : item
    )
  }
  const existingIndex = items.findIndex((item) => item.id === next.id)
  if (existingIndex >= 0) items.splice(existingIndex, 1, next)
  else items.push(next)
  return items.slice(-maximum)
}

export function currentAssistantActivity(items) {
  const activities = Array.isArray(items) ? items : []
  return (
    [...activities].reverse().find((item) => item.status === 'running') ||
    [...activities].reverse().find((item) => item.status === 'paused') ||
    activities.at(-1) ||
    null
  )
}
