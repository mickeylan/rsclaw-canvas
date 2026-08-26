export function assessCanvasDraftConflict({
  expectedVersion,
  currentVersion,
  baseCanvasFingerprint,
  currentCanvasFingerprint,
  operations = []
}) {
  if (Number(expectedVersion) === Number(currentVersion)) {
    return { canApply: true, rebased: false, reason: 'exact_version' }
  }
  if (baseCanvasFingerprint && baseCanvasFingerprint === currentCanvasFingerprint) {
    return { canApply: true, rebased: true, reason: 'canvas_unchanged' }
  }
  if (operations.length > 0 && operations.every((operation) => operation.op === 'createNode')) {
    return { canApply: true, rebased: true, reason: 'additive_only' }
  }
  return { canApply: false, rebased: false, reason: 'canvas_changed' }
}
