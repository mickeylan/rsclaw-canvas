import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'lumx.desktop.appearance'

function readSavedMode() {
  if (typeof window === 'undefined') return 'dark'
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

export const useAppearanceStore = defineStore('appearance', () => {
  const mode = ref(readSavedMode())
  const isDark = computed(() => mode.value === 'dark')

  watch(
    mode,
    (value) => {
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = value
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, value)
        window.lumx?.setAppearance?.(value).catch(() => {})
      }
    },
    { immediate: true }
  )

  function setMode(value) {
    mode.value = value === 'light' ? 'light' : 'dark'
  }

  return {
    mode,
    isDark,
    setMode
  }
})
