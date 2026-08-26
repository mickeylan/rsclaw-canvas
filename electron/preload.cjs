const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lumx', {
  platform: process.platform,
  invoke(command, args = {}) {
    return ipcRenderer.invoke('lumx:invoke', command, args)
  },
  onAgentEvent(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('lumx:agent-event', handler)
    return () => ipcRenderer.removeListener('lumx:agent-event', handler)
  },
  onCloseRequested(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    const handler = () => listener()
    ipcRenderer.on('lumx:close-requested', handler)
    ipcRenderer.send('lumx:set-close-guard', true)
    return () => {
      ipcRenderer.removeListener('lumx:close-requested', handler)
      ipcRenderer.send('lumx:set-close-guard', false)
    }
  },
  setAppearance(mode) {
    return ipcRenderer.invoke('lumx:set-appearance', mode)
  },
  closeWindow() {
    return ipcRenderer.invoke('lumx:close-window')
  }
})
