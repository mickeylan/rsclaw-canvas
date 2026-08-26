export function desktopErrorMessage(error) {
  return String(error?.message || error || '操作失败')
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}
