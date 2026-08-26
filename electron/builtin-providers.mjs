export const BUILTIN_PROVIDER_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'builtin_minimax',
    name: 'MiniMax',
    providerType: 'minimax',
    baseUrl: 'https://api.minimax.chat/v1',
    officialUrl: 'https://www.minimax.chat/'
  }),
  Object.freeze({
    id: 'builtin_ollama',
    name: 'Ollama (llama.cpp)',
    providerType: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    officialUrl: 'https://ollama.com/'
  }),
  Object.freeze({
    id: 'builtin_openai',
    name: 'OpenAI',
    providerType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    officialUrl: 'https://platform.openai.com'
  }),
  Object.freeze({
    id: 'builtin_deepseek',
    name: 'DeepSeek',
    providerType: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    officialUrl: 'https://platform.deepseek.com'
  }),
  Object.freeze({
    id: 'builtin_grsai',
    name: 'GRSAI',
    providerType: 'grsai',
    baseUrl: 'https://grsai.dakka.com.cn',
    officialUrl: 'https://grsai.ai/'
  })
])

const BUILTIN_PROVIDERS_BY_TYPE = new Map(
  BUILTIN_PROVIDER_DEFINITIONS.map((provider) => [provider.providerType, provider])
)
const BUILTIN_PROVIDER_OFFICIAL_URLS = new Set(
  BUILTIN_PROVIDER_DEFINITIONS.map((provider) => provider.officialUrl)
)

export function builtinProviderDefinition(providerType) {
  return BUILTIN_PROVIDERS_BY_TYPE.get(String(providerType || '')) || null
}

export function isBuiltinProviderType(providerType) {
  return BUILTIN_PROVIDERS_BY_TYPE.has(String(providerType || ''))
}

export function isBuiltinProviderOfficialUrl(url) {
  return BUILTIN_PROVIDER_OFFICIAL_URLS.has(String(url || ''))
}

export function withBuiltinProviderFields(provider, definition) {
  if (!definition) return { ...provider, isBuiltin: false }
  return {
    ...provider,
    name: definition.name,
    providerType: definition.providerType,
    baseUrl: definition.baseUrl,
    officialUrl: definition.officialUrl,
    enabled: true,
    isBuiltin: true
  }
}

export function ensureBuiltinProviderProfiles(profiles, createProfile) {
  const next = (profiles || []).map((profile) =>
    withBuiltinProviderFields(profile, builtinProviderDefinition(profile?.providerType))
  )
  for (const definition of BUILTIN_PROVIDER_DEFINITIONS) {
    if (next.some((profile) => profile.providerType === definition.providerType)) continue
    next.push(
      withBuiltinProviderFields(
        createProfile ? createProfile(definition) : { ...definition },
        definition
      )
    )
  }
  return next
}
