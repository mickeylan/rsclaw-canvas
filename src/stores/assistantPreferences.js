import { ref } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'rsclaw.canvas.assistant-preferences'

function readSavedPreferences() {
  if (typeof window === 'undefined') return {}
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

export const useAssistantPreferencesStore = defineStore('assistantPreferences', () => {
  const saved = readSavedPreferences()
  const imageProviderId = ref(String(saved.imageProviderId || ''))
  const imageModel = ref(String(saved.imageModel || ''))
  const imageResolution = ref(String(saved.imageResolution || ''))

  function setImageDefaults(input = {}) {
    imageProviderId.value = String(input.providerId || '')
    imageModel.value = String(input.model || '')
    imageResolution.value = String(input.resolution || '')
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          imageProviderId: imageProviderId.value,
          imageModel: imageModel.value,
          imageResolution: imageResolution.value
        })
      )
    }
  }

  return {
    imageProviderId,
    imageModel,
    imageResolution,
    setImageDefaults
  }
})
