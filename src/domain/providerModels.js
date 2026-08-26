export const MODEL_TYPES = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' }
]

const MODEL_TYPE_VALUES = new Set(MODEL_TYPES.map((item) => item.value))

export const PROVIDER_MODEL_CAPABILITIES = {
  'openai-compatible': ['text', 'image'],
  deepseek: ['text'],
  grsai: ['image'],
  ark: ['text', 'video'],
  apimart: ['text', 'image'],
  minimax: ['audio'],
  ollama: ['text']
}

export const DEFAULT_IMAGE_SIZE_SPECS = [
  { id: 'size_1k_1_1', ratio: '1:1', resolution: '1K', requestSize: '1024x1024' },
  { id: 'size_1k_16_9', ratio: '16:9', resolution: '1K', requestSize: '1280x720' },
  { id: 'size_1k_9_16', ratio: '9:16', resolution: '1K', requestSize: '720x1280' },
  { id: 'size_1k_4_5', ratio: '4:5', resolution: '1K', requestSize: '896x1120' }
]

export const GPT_IMAGE_2_VIP_SIZE_SPECS = [
  { id: 'gpt_image_2_vip_auto', ratio: 'auto', resolution: 'auto', requestSize: 'auto' },
  { id: 'gpt_image_2_vip_1k_1_1', ratio: '1:1', resolution: '1K', requestSize: '1024x1024' },
  { id: 'gpt_image_2_vip_2k_1_1', ratio: '1:1', resolution: '2K', requestSize: '2048x2048' },
  { id: 'gpt_image_2_vip_4k_1_1', ratio: '1:1', resolution: '4K', requestSize: '2880x2880' },
  { id: 'gpt_image_2_vip_1k_16_9', ratio: '16:9', resolution: '1K', requestSize: '1280x720' },
  { id: 'gpt_image_2_vip_2k_16_9', ratio: '16:9', resolution: '2K', requestSize: '2048x1152' },
  { id: 'gpt_image_2_vip_4k_16_9', ratio: '16:9', resolution: '4K', requestSize: '3840x2160' },
  { id: 'gpt_image_2_vip_1k_9_16', ratio: '9:16', resolution: '1K', requestSize: '720x1280' },
  { id: 'gpt_image_2_vip_2k_9_16', ratio: '9:16', resolution: '2K', requestSize: '1152x2048' },
  { id: 'gpt_image_2_vip_4k_9_16', ratio: '9:16', resolution: '4K', requestSize: '2160x3840' },
  { id: 'gpt_image_2_vip_1k_4_3', ratio: '4:3', resolution: '1K', requestSize: '1152x864' },
  { id: 'gpt_image_2_vip_2k_4_3', ratio: '4:3', resolution: '2K', requestSize: '2304x1728' },
  { id: 'gpt_image_2_vip_4k_4_3', ratio: '4:3', resolution: '4K', requestSize: '3264x2448' },
  { id: 'gpt_image_2_vip_1k_3_4', ratio: '3:4', resolution: '1K', requestSize: '864x1152' },
  { id: 'gpt_image_2_vip_2k_3_4', ratio: '3:4', resolution: '2K', requestSize: '1728x2304' },
  { id: 'gpt_image_2_vip_4k_3_4', ratio: '3:4', resolution: '4K', requestSize: '2448x3264' },
  { id: 'gpt_image_2_vip_1k_3_2', ratio: '3:2', resolution: '1K', requestSize: '1536x1024' },
  { id: 'gpt_image_2_vip_2k_3_2', ratio: '3:2', resolution: '2K', requestSize: '2048x1360' },
  { id: 'gpt_image_2_vip_4k_3_2', ratio: '3:2', resolution: '4K', requestSize: '3504x2336' },
  { id: 'gpt_image_2_vip_1k_2_3', ratio: '2:3', resolution: '1K', requestSize: '1024x1536' },
  { id: 'gpt_image_2_vip_2k_2_3', ratio: '2:3', resolution: '2K', requestSize: '1360x2048' },
  { id: 'gpt_image_2_vip_4k_2_3', ratio: '2:3', resolution: '4K', requestSize: '2336x3504' },
  { id: 'gpt_image_2_vip_1k_5_4', ratio: '5:4', resolution: '1K', requestSize: '1120x896' },
  { id: 'gpt_image_2_vip_2k_5_4', ratio: '5:4', resolution: '2K', requestSize: '2240x1792' },
  { id: 'gpt_image_2_vip_4k_5_4', ratio: '5:4', resolution: '4K', requestSize: '3200x2560' },
  { id: 'gpt_image_2_vip_1k_4_5', ratio: '4:5', resolution: '1K', requestSize: '896x1120' },
  { id: 'gpt_image_2_vip_2k_4_5', ratio: '4:5', resolution: '2K', requestSize: '1792x2240' },
  { id: 'gpt_image_2_vip_4k_4_5', ratio: '4:5', resolution: '4K', requestSize: '2560x3200' },
  { id: 'gpt_image_2_vip_1k_21_9', ratio: '21:9', resolution: '1K', requestSize: '1456x624' },
  { id: 'gpt_image_2_vip_2k_21_9', ratio: '21:9', resolution: '2K', requestSize: '2912x1248' },
  { id: 'gpt_image_2_vip_4k_21_9', ratio: '21:9', resolution: '4K', requestSize: '3840x1648' },
  { id: 'gpt_image_2_vip_1k_9_21', ratio: '9:21', resolution: '1K', requestSize: '624x1456' },
  { id: 'gpt_image_2_vip_2k_9_21', ratio: '9:21', resolution: '2K', requestSize: '1248x2912' },
  { id: 'gpt_image_2_vip_4k_9_21', ratio: '9:21', resolution: '4K', requestSize: '1648x3840' },
  { id: 'gpt_image_2_vip_2k_1_3', ratio: '1:3', resolution: '2K', requestSize: '688x2048' },
  { id: 'gpt_image_2_vip_4k_1_3', ratio: '1:3', resolution: '4K', requestSize: '1280x3840' },
  { id: 'gpt_image_2_vip_2k_3_1', ratio: '3:1', resolution: '2K', requestSize: '2048x688' },
  { id: 'gpt_image_2_vip_4k_3_1', ratio: '3:1', resolution: '4K', requestSize: '3840x1280' },
  { id: 'gpt_image_2_vip_1k_2_1', ratio: '2:1', resolution: '1K', requestSize: '1536x768' },
  { id: 'gpt_image_2_vip_2k_2_1', ratio: '2:1', resolution: '2K', requestSize: '3072x1536' },
  { id: 'gpt_image_2_vip_4k_2_1', ratio: '2:1', resolution: '4K', requestSize: '3840x1920' },
  { id: 'gpt_image_2_vip_1k_1_2', ratio: '1:2', resolution: '1K', requestSize: '768x1536' },
  { id: 'gpt_image_2_vip_2k_1_2', ratio: '1:2', resolution: '2K', requestSize: '1536x3072' },
  { id: 'gpt_image_2_vip_4k_1_2', ratio: '1:2', resolution: '4K', requestSize: '1920x3840' }
]

export function normalizeImageSizeSpecs(sizeSpecs) {
  if (!Array.isArray(sizeSpecs)) return []
  return sizeSpecs
    .map((spec) => ({
      id: String(spec?.id || '').trim(),
      ratio: String(spec?.ratio || '').trim(),
      resolution: String(spec?.resolution || '').trim(),
      requestSize: String(spec?.requestSize || '').trim()
    }))
    .filter((spec) => spec.id && spec.ratio && spec.resolution && spec.requestSize)
}

export function defaultImageSizeSpecs() {
  return DEFAULT_IMAGE_SIZE_SPECS.map((spec) => ({ ...spec }))
}

export function gptImage2VipSizeSpecs() {
  return GPT_IMAGE_2_VIP_SIZE_SPECS.map((spec) => ({ ...spec }))
}

export function imageResolutionOptions(sizeSpecs) {
  return [
    ...new Set(
      normalizeImageSizeSpecs(sizeSpecs)
        .map((spec) => spec.resolution)
        .filter((resolution) => resolution.toLowerCase() !== 'auto')
    )
  ]
}

export function imageRatioOptions(sizeSpecs, resolution) {
  const specs = normalizeImageSizeSpecs(sizeSpecs)
  const options = specs.filter((spec) => spec.resolution === resolution).map((spec) => spec.ratio)
  if (specs.some((spec) => spec.ratio.toLowerCase() === 'auto')) {
    options.unshift('auto')
  }
  return [...new Set(options)]
}

export function imageSizeSpecForSelection(sizeSpecs, resolution, ratio) {
  const specs = normalizeImageSizeSpecs(sizeSpecs)
  if (String(ratio).toLowerCase() === 'auto') {
    return specs.find((spec) => spec.ratio.toLowerCase() === 'auto') || null
  }
  return specs.find((spec) => spec.resolution === resolution && spec.ratio === ratio) || null
}

export function providerModels(provider, modelType) {
  if (!Array.isArray(provider?.models)) return []
  return provider.models
    .filter((model) => model && model.modelType === modelType)
    .map((model) => ({
      id: String(model.id || ''),
      modelId: String(model.modelId || '').trim(),
      displayName: String(model.displayName || '').trim(),
      modelType: String(model.modelType || ''),
      sizeSpecs: modelType === 'image' ? normalizeImageSizeSpecs(model.sizeSpecs) : []
    }))
    .filter((model) => model.modelId && model.displayName)
}

export function providerSupportsModelType(provider, modelType) {
  return providerModels(provider, modelType).length > 0
}

export function modelChoicesForType(providers, modelType) {
  const choices = (providers || []).flatMap((provider) =>
    providerModels(provider, modelType).map((model) => ({
      ...model,
      selectionId: model.id || `${provider.id}:${model.modelId}`,
      providerId: provider.id,
      providerName: provider.name
    }))
  )
  const displayNameCounts = new Map()
  choices.forEach((choice) => {
    const key = choice.displayName.toLocaleLowerCase()
    displayNameCounts.set(key, (displayNameCounts.get(key) || 0) + 1)
  })
  return choices.map((choice) => ({
    ...choice,
    label:
      displayNameCounts.get(choice.displayName.toLocaleLowerCase()) > 1
        ? `${choice.displayName} · ${choice.providerName}`
        : choice.displayName
  }))
}

export function selectedModelChoice(choices, providerId, modelId) {
  return (
    (choices || []).find(
      (choice) => choice.providerId === providerId && choice.modelId === modelId
    ) || null
  )
}

export function defaultProviderModel(provider, modelType) {
  return providerModels(provider, modelType)[0]?.modelId || ''
}

export function modelTypeLabel(modelType) {
  return MODEL_TYPES.find((item) => item.value === modelType)?.label || modelType
}

export function isModelType(modelType) {
  return MODEL_TYPE_VALUES.has(modelType)
}

export function modelTypesForProvider(providerType) {
  const supported = new Set(PROVIDER_MODEL_CAPABILITIES[providerType] || [])
  return MODEL_TYPES.filter((item) => supported.has(item.value))
}

export function providerTypeSupportsModel(providerType, modelType) {
  return (PROVIDER_MODEL_CAPABILITIES[providerType] || []).includes(modelType)
}
