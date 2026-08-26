import { onBeforeUnmount, onMounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  closeDesktopWindow,
  isDesktopRuntime,
  onDesktopCloseRequested,
  saveCanvas
} from '../services/localBridge'

export function useCanvasPersistence({
  project,
  nodes,
  edges,
  ready,
  getViewport,
  serializeNode,
  serializeEdge
}) {
  let saveTimer = null
  let saveRetryTimer = null
  let activeSave = null
  let saveRequested = false
  let lastSaveError = null
  let saveFailureNotified = false
  let saveRetryDelay = 1500
  let unlistenCloseRequested = null
  let closingWindow = false

  onMounted(async () => {
    window.addEventListener('beforeunload', handleBeforeUnload)
    if (isDesktopRuntime()) {
      unlistenCloseRequested = await onDesktopCloseRequested(handleCloseRequested)
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    unlistenCloseRequested?.()
    clearTimeout(saveTimer)
    clearTimeout(saveRetryTimer)
  })

  onBeforeRouteLeave(async () => {
    try {
      await flushSave()
      return true
    } catch {
      message.error('画布尚未保存成功，请修复保存问题后再离开')
      return false
    }
  })

  function scheduleSave() {
    saveRequested = true
    if (activeSave) return
    clearTimeout(saveRetryTimer)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => persistCanvas(), 450)
  }

  async function persistCanvas() {
    if (!project.value || !ready.value) return
    clearTimeout(saveTimer)
    saveTimer = null
    saveRequested = true
    if (activeSave) return activeSave

    const request = (async () => {
      while (saveRequested) {
        saveRequested = false
        const canvasJson = JSON.stringify({
          nodes: nodes.value.map(serializeNode),
          edges: edges.value.map(serializeEdge)
        })
        const viewportJson = JSON.stringify(getViewport())
        project.value = await saveCanvas(
          project.value.id,
          canvasJson,
          viewportJson,
          project.value.version
        )
      }
    })()

    activeSave = request
    try {
      await request
      lastSaveError = null
      saveFailureNotified = false
      saveRetryDelay = 1500
    } catch (error) {
      lastSaveError = error
      saveRequested = true
      console.error('[workspace] local save failed', error)
      if (!saveFailureNotified) {
        message.error(`画布保存失败：${error?.message || error}`)
        saveFailureNotified = true
      }
      if (!String(error?.message || error).includes('版本已变化')) {
        clearTimeout(saveRetryTimer)
        saveRetryTimer = setTimeout(() => persistCanvas(), saveRetryDelay)
        saveRetryDelay = Math.min(saveRetryDelay * 2, 30000)
      }
    } finally {
      if (activeSave === request) activeSave = null
    }
  }

  async function flushSave() {
    clearTimeout(saveRetryTimer)
    saveRetryTimer = null
    if (saveTimer || saveRequested) await persistCanvas()
    if (activeSave) await activeSave.catch(() => {})
    if (lastSaveError) throw lastSaveError
  }

  function hasUnsavedChanges() {
    return Boolean(saveTimer || saveRetryTimer || saveRequested || activeSave || lastSaveError)
  }

  function handleBeforeUnload(event) {
    if (!hasUnsavedChanges()) return
    event.preventDefault()
    event.returnValue = ''
  }

  async function handleCloseRequested(event) {
    if (closingWindow) return
    event.preventDefault()
    try {
      await flushSave()
      closingWindow = true
      await closeDesktopWindow()
    } catch {
      message.error('画布尚未保存成功，窗口已保持打开')
    }
  }

  return {
    flushSave,
    scheduleSave
  }
}
