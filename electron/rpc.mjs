import { randomUUID } from 'node:crypto'

export class UtilityRpc {
  constructor(child, { onRequest, onEvent } = {}) {
    this.child = child
    this.onRequest = onRequest
    this.onEvent = onEvent
    this.pending = new Map()
    child.on('message', (message) => this.#handle(message))
    child.on('exit', (code) => {
      const error = new Error(`Utility process exited with code ${code}`)
      for (const { reject } of this.pending.values()) reject(error)
      this.pending.clear()
    })
  }

  request(method, params = {}, timeoutMs = 120000) {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve(value) {
          clearTimeout(timer)
          resolve(value)
        },
        reject(error) {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.child.postMessage({ kind: 'rpc.request', id, method, params })
    })
  }

  notify(method, params = {}) {
    this.child.postMessage({ kind: 'rpc.notification', method, params })
  }

  async #handle(message) {
    if (!message || typeof message !== 'object') return
    if (message.kind === 'rpc.response') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || String(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (message.kind === 'rpc.event') {
      this.onEvent?.(message.event)
      return
    }
    if (message.kind === 'rpc.request' && this.onRequest) {
      try {
        const result = await this.onRequest(message.method, message.params)
        this.child.postMessage({ kind: 'rpc.response', id: message.id, result })
      } catch (error) {
        this.child.postMessage({
          kind: 'rpc.response',
          id: message.id,
          error: { message: error?.message || String(error) }
        })
      }
    }
  }
}

export class ParentRpc {
  constructor(parentPort, handlers = {}) {
    this.parentPort = parentPort
    this.handlers = handlers
    this.pending = new Map()
    parentPort.on('message', (event) => this.#handle(event.data))
  }

  request(method, params = {}, timeoutMs = 120000) {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve(value) {
          clearTimeout(timer)
          resolve(value)
        },
        reject(error) {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.parentPort.postMessage({ kind: 'rpc.request', id, method, params })
    })
  }

  emit(event) {
    this.parentPort.postMessage({ kind: 'rpc.event', event })
  }

  async #handle(message) {
    if (!message || typeof message !== 'object') return
    if (message.kind === 'rpc.response') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || String(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (message.kind !== 'rpc.request') return
    const handler = this.handlers[message.method]
    if (!handler) {
      this.parentPort.postMessage({
        kind: 'rpc.response',
        id: message.id,
        error: { message: `Unknown method: ${message.method}` }
      })
      return
    }
    try {
      const result = await handler(message.params)
      this.parentPort.postMessage({ kind: 'rpc.response', id: message.id, result })
    } catch (error) {
      this.parentPort.postMessage({
        kind: 'rpc.response',
        id: message.id,
        error: { message: error?.message || String(error) }
      })
    }
  }
}
