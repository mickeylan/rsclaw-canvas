import { spawn } from 'node:child_process'
import electronPath from 'electron'

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Electron dev launcher requires npm_execpath')
const vite = spawn(process.execPath, [npmCli, 'run', 'dev'], {
  stdio: 'inherit',
  shell: false
})

await waitForVite()

const electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    LUMX_SYSTEM_SKILL_DEV: process.env.LUMX_SYSTEM_SKILL_DEV || '1'
  }
})

const stop = () => {
  if (!electron.killed) electron.kill()
  if (!vite.killed) vite.kill()
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)

const exitCode = await new Promise((resolve) => {
  electron.once('exit', (code) => resolve(code || 0))
  vite.once('exit', (code) => {
    if (code) resolve(code)
  })
})
stop()
process.exitCode = exitCode

async function waitForVite() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited with code ${vite.exitCode}`)
    try {
      const response = await fetch('http://127.0.0.1:1420', {
        signal: AbortSignal.timeout(1000)
      })
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vite did not become ready within 30 seconds')
}
