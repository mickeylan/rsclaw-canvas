const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('rsclaw', {
  platform: process.platform,
  invoke(command, args = {}) {
    return ipcRenderer.invoke('rsclaw:invoke', command, args)
  },
  onAgentEvent(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('rsclaw:agent-event', handler)
    return () => ipcRenderer.removeListener('rsclaw:agent-event', handler)
  },
  onCloseRequested(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    const handler = () => listener()
    ipcRenderer.on('rsclaw:close-requested', handler)
    ipcRenderer.send('rsclaw:set-close-guard', true)
    return () => {
      ipcRenderer.removeListener('rsclaw:close-requested', handler)
      ipcRenderer.send('rsclaw:set-close-guard', false)
    }
  },
  setAppearance(mode) {
    return ipcRenderer.invoke('rsclaw:set-appearance', mode)
  },
  closeWindow() {
    return ipcRenderer.invoke('rsclaw:close-window')
  }
})
