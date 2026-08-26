export async function readChatResponse(response, { isOllama = false, onTextDelta } = {}) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  const streaming =
    contentType.includes('text/event-stream') ||
    contentType.includes('application/x-ndjson') ||
    contentType.includes('application/ndjson')

  if (!streaming) {
    const payload = parseJson(await response.text(), {})
    const message = isOllama ? payload.message : payload.choices?.[0]?.message
    if (!message) throw new Error('模型响应缺少 message')
    const content = normalizeContent(message.content)
    if (content) onTextDelta?.(content)
    return {
      content,
      toolCalls: normalizeToolCalls(message.tool_calls),
      usage: normalizeUsage(payload)
    }
  }

  let content = ''
  let buffer = ''
  let usage = {}
  const toolCalls = new Map()
  const decoder = new TextDecoder()

  const consumeLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed === 'data: [DONE]') return
    const json = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!json || json === '[DONE]') return
    const payload = parseJson(json, null)
    if (!payload) return

    const delta = isOllama ? payload.message || {} : payload.choices?.[0]?.delta || {}
    const text = normalizeContent(delta.content)
    if (text) {
      content += text
      onTextDelta?.(text)
    }
    mergeToolCalls(toolCalls, delta.tool_calls)
    usage = { ...usage, ...normalizeUsage(payload) }
  }

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) consumeLine(line)
  }
  buffer += decoder.decode()
  if (buffer.trim()) consumeLine(buffer)

  return {
    content,
    toolCalls: [...toolCalls.values()].map((call) => ({
      id: call.id,
      name: call.name,
      args: parseJson(call.arguments, {})
    })),
    usage
  }
}

function mergeToolCalls(target, calls = []) {
  for (const [position, call] of calls.entries()) {
    const index = Number.isInteger(call.index) ? call.index : position
    const current = target.get(index) || {
      id: '',
      name: '',
      arguments: ''
    }
    if (call.id) current.id = call.id
    const fn = call.function || call
    if (fn.name) current.name += fn.name
    if (typeof fn.arguments === 'string') current.arguments += fn.arguments
    else if (fn.arguments) current.arguments = JSON.stringify(fn.arguments)
    target.set(index, current)
  }
}

function normalizeToolCalls(calls = []) {
  return calls.map((call) => {
    const fn = call.function || call
    return {
      id: call.id,
      name: fn.name,
      args: typeof fn.arguments === 'string' ? parseJson(fn.arguments, {}) : fn.arguments || {}
    }
  })
}

function normalizeContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text' || typeof part?.text === 'string')
    .map((part) => part.text || '')
    .join('')
}

function normalizeUsage(payload) {
  const inputTokens = payload.usage?.prompt_tokens || payload.prompt_eval_count || 0
  const outputTokens = payload.usage?.completion_tokens || payload.eval_count || 0
  const totalTokens = payload.usage?.total_tokens || inputTokens + outputTokens
  return { inputTokens, outputTokens, totalTokens }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
