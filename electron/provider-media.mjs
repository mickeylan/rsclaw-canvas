export async function startProviderTask(runtime, apiKey, task) {
  const request = parseJson(task.requestJson, {})
  if (runtime.providerType === 'grsai' && task.taskType.startsWith('image.')) {
    const payload = await sendJson(runtime, apiKey, 'POST', 'v1/api/generate', {
      model: request.model || 'nano-banana-fast',
      prompt: required(request.prompt, '请输入图片提示词'),
      images: request.referenceUrls || [],
      replyType: 'json',
      aspectRatio: request.requestSize || request.aspectRatio || '1:1',
      ...(String(request.model || '')
        .toLowerCase()
        .startsWith('gpt-image-2')
        ? {}
        : { imageSize: request.resolution || '1K' })
    })
    return commonState(
      payload.id,
      payload.status || 'pending',
      payload.progress,
      grsaiResults(payload),
      payload
    )
  }
  if (runtime.providerType === 'apimart' && task.taskType.startsWith('image.')) {
    const body = {
      model: request.model || 'gpt-image-2',
      prompt: required(request.prompt, '请输入图片提示词'),
      n: 1,
      size: request.requestSize || request.aspectRatio || 'auto',
      resolution: String(request.resolution || '1k').toLowerCase()
    }
    if (request.referenceUrls?.length) body.image_urls = request.referenceUrls
    const payload = await sendJson(runtime, apiKey, 'POST', 'v1/images/generations', body)
    ensureBusinessSuccess(payload, 'APIMart')
    const data = payload.data?.[0] || {}
    return commonState(data.task_id, data.status || 'submitted', 0, [], payload)
  }
  if (runtime.providerType === 'openai-compatible' && task.taskType.startsWith('image.')) {
    const payload = await sendJson(runtime, apiKey, 'POST', 'v1/images/generations', {
      model: required(request.model, '请选择图片模型'),
      prompt: required(request.prompt, '请输入图片提示词'),
      n: 1,
      size: request.requestSize || request.aspectRatio || 'auto',
      ...(request.quality ? { quality: request.quality } : {})
    })
    const results = (payload.data || [])
      .map((item) => ({
        url: item.url || '',
        content: item.b64_json || '',
        kind: 'image',
        mimeType: 'image/png'
      }))
      .filter((item) => item.url || item.content)
    if (!results.length) throw new Error('图片接口没有返回可用结果')
    return { providerTaskId: '', status: 'completed', progress: 100, results, output: payload }
  }
  if (
    (runtime.providerType === 'ark' || runtime.providerType === 'volcengine') &&
    task.taskType.startsWith('video.')
  ) {
    const content = [{ type: 'text', text: required(request.prompt, '请输入视频提示词') }]
    for (const reference of request.references || []) {
      if (!['image', 'video', 'audio'].includes(reference.kind) || !reference.url) continue
      content.push({
        type: `${reference.kind}_url`,
        [`${reference.kind}_url`]: { url: reference.url },
        role: reference.role || `reference_${reference.kind}`
      })
    }
    const payload = await sendJson(runtime, apiKey, 'POST', 'api/v3/contents/generations/tasks', {
      model: request.model || 'doubao-seedance-2-0-fast-260128',
      content,
      generate_audio: request.generateAudio !== false,
      ratio: request.ratio || 'adaptive',
      resolution: request.resolution || '480p',
      duration: Math.max(1, Number(request.duration || 5)),
      watermark: false
    })
    return commonState(payload.id, 'pending', 0, [], payload)
  }
  if (runtime.providerType === 'minimax' && task.taskType === 'audio.generate') {
    const payload = await sendJson(runtime, apiKey, 'POST', 'v1/t2a_async_v2', {
      model: request.model || 'speech-2.8-hd',
      text: required(request.prompt, '请输入需要合成的文本'),
      voice_setting: {
        voice_id: request.voiceId || 'male-qn-qingse',
        speed: Number(request.speed || 1),
        vol: Number(request.volume || 1),
        pitch: Number(request.pitch || 0)
      },
      audio_setting: {
        audio_sample_rate: Number(request.sampleRate || 32000),
        bitrate: Number(request.bitrate || 128000),
        format: request.format || 'mp3',
        channel: Number(request.channel || 1)
      }
    })
    ensureMiniMaxSuccess(payload)
    return commonState(payload.task_id || payload.taskId, 'pending', 0, [], payload)
  }
  throw new Error(`供应商 ${runtime.providerType} 暂不支持任务 ${task.taskType}`)
}

export async function pollProviderTask(runtime, apiKey, task) {
  const id = required(task.providerTaskId, '供应商任务 ID 为空')
  if (runtime.providerType === 'grsai') {
    const payload = await sendJson(
      runtime,
      apiKey,
      'GET',
      `v1/api/result?id=${encodeURIComponent(id)}`
    )
    return commonState(
      id,
      payload.status || 'pending',
      payload.progress,
      grsaiResults(payload),
      payload
    )
  }
  if (runtime.providerType === 'apimart') {
    const payload = await sendJson(runtime, apiKey, 'GET', `v1/tasks/${encodeURIComponent(id)}`)
    ensureBusinessSuccess(payload, 'APIMart')
    const results = (payload.data?.result?.images || []).flatMap((image) =>
      (Array.isArray(image.url) ? image.url : [image.url])
        .filter(Boolean)
        .map((url) => ({ url, content: '', kind: 'image', mimeType: 'image/png' }))
    )
    return commonState(
      payload.data?.id || id,
      payload.data?.status || 'pending',
      payload.data?.progress,
      results,
      payload,
      payload.data?.error?.message || payload.message || payload.msg
    )
  }
  if (runtime.providerType === 'ark' || runtime.providerType === 'volcengine') {
    const payload = await sendJson(
      runtime,
      apiKey,
      'GET',
      `api/v3/contents/generations/tasks/${encodeURIComponent(id)}`
    )
    const results = collectUrls(payload).map((url) => ({
      url,
      content: '',
      kind: 'video',
      mimeType: 'video/mp4'
    }))
    return commonState(
      id,
      payload.status || payload.data?.status || 'pending',
      payload.progress || payload.data?.progress,
      results,
      payload,
      payload.failure_reason || payload.data?.failure_reason || payload.error || payload.message
    )
  }
  if (runtime.providerType === 'minimax') {
    const payload = await sendJson(
      runtime,
      apiKey,
      'GET',
      `v1/query/t2a_async_query_v2?task_id=${encodeURIComponent(id)}`
    )
    ensureMiniMaxSuccess(payload)
    const normalized = normalizeStatus(payload.status || payload.task_status)
    let results = []
    if (normalized === 'completed') {
      const fileId = required(payload.file_id || payload.fileId, 'MiniMax 完成响应缺少 file_id')
      const response = await authorizedFetch(
        runtime,
        apiKey,
        `v1/files/retrieve_content?file_id=${encodeURIComponent(fileId)}`
      )
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (!bytes.length) throw new Error('MiniMax 返回了空音频')
      results = [
        {
          url: '',
          content: Buffer.from(bytes).toString('base64'),
          kind: 'audio',
          mimeType: 'audio/mpeg'
        }
      ]
    }
    return commonState(id, normalized, normalized === 'completed' ? 100 : 50, results, payload)
  }
  throw new Error('当前任务不需要轮询或没有对应适配器')
}

async function sendJson(runtime, apiKey, method, endpoint, body) {
  const response = await authorizedFetch(runtime, apiKey, endpoint, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const text = await response.text()
  const payload = parseJson(text, null)
  if (!payload) throw new Error('供应商返回的内容不是有效 JSON')
  return payload
}

async function authorizedFetch(runtime, apiKey, endpoint, options = {}) {
  const url = joinEndpoint(runtime.baseUrl, endpoint)
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    signal: AbortSignal.timeout(120000)
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`供应商请求失败（${response.status}）：${remoteMessage(text)}`)
  }
  return response
}

function commonState(providerTaskId, rawStatus, progress, results, output, errorMessage = '') {
  if (!providerTaskId && normalizeStatus(rawStatus) !== 'completed') {
    throw new Error('供应商响应缺少任务 ID')
  }
  return {
    providerTaskId: providerTaskId || '',
    status: normalizeStatus(rawStatus),
    progress: Math.max(0, Math.min(100, Number(progress || 0))),
    results,
    output,
    errorMessage: String(errorMessage || '')
  }
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase()
  if (['completed', 'complete', 'success', 'succeeded', 'done'].includes(status)) return 'completed'
  if (['failed', 'failure', 'error', 'canceled', 'cancelled'].includes(status)) return 'failed'
  return 'polling'
}

function grsaiResults(payload) {
  return (payload.results || [])
    .map((item) => ({
      url: item.url || '',
      content: item.content || '',
      kind: 'image',
      mimeType: 'image/png'
    }))
    .filter((item) => item.url || item.content)
}

function collectUrls(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output)
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (
        typeof item === 'string' &&
        /^https?:\/\//i.test(item) &&
        /(url|video|output|result)/i.test(key)
      ) {
        output.add(item)
      } else {
        collectUrls(item, output)
      }
    }
  }
  return [...output]
}

function ensureBusinessSuccess(payload, provider) {
  const code = payload.code
  if (code !== undefined && ![0, 200, '0', '200', 'success'].includes(code)) {
    throw new Error(`${provider} 返回错误：${payload.message || payload.msg || code}`)
  }
}

function ensureMiniMaxSuccess(payload) {
  const code = payload.base_resp?.status_code
  if (code !== undefined && Number(code) !== 0) {
    throw new Error(`MiniMax 返回错误：${payload.base_resp?.status_msg || code}`)
  }
}

function joinEndpoint(base, endpoint) {
  const root = String(base || '').replace(/\/+$/, '')
  const suffix = String(endpoint || '').replace(/^\/+/, '')
  if (/\/v1$/i.test(root) && suffix.startsWith('v1/')) return `${root}/${suffix.slice(3)}`
  return `${root}/${suffix}`
}

function remoteMessage(text) {
  const payload = parseJson(text, {})
  return String(
    payload.error?.message || payload.message || payload.msg || text || '未知错误'
  ).slice(0, 800)
}

function parseJson(value, fallback) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return fallback
  }
}

function required(value, message) {
  const text = String(value || '').trim()
  if (!text) throw new Error(message)
  return text
}
