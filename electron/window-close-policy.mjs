export function shouldInterceptWindowClose({ allowWindowClose, closeGuardEnabled }) {
  return !allowWindowClose && closeGuardEnabled
}
