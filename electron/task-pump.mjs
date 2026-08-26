export function createConcurrentTaskPump({
  claim,
  process,
  concurrency = 4,
  onError = console.error
}) {
  if (typeof claim !== 'function' || typeof process !== 'function') {
    throw new TypeError('任务调度器需要 claim 和 process 函数')
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('任务并发数必须是正整数')
  }

  const activeTasks = new Set()
  let filling = false
  let refillRequested = false
  let stopped = false

  async function run() {
    if (stopped) return
    if (filling) {
      refillRequested = true
      return
    }

    filling = true
    try {
      while (!stopped && activeTasks.size < concurrency) {
        const claimedTask = await claim()
        if (!claimedTask) break

        const activeTask = Promise.resolve()
          .then(() => process(claimedTask))
          .catch(onError)
          .finally(() => {
            activeTasks.delete(activeTask)
            if (!stopped) void run()
          })
        activeTasks.add(activeTask)
      }
    } catch (error) {
      onError(error)
    } finally {
      filling = false
      if (refillRequested && !stopped) {
        refillRequested = false
        void run()
      }
    }
  }

  function stop() {
    stopped = true
  }

  return {
    run,
    stop,
    get activeCount() {
      return activeTasks.size
    }
  }
}
