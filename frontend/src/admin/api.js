import { apiRequest } from '../shared/api'

export const ADMIN_CSRF = 'mailadmin_csrf_admin'

export function adminRequest(path, options = {}) {
  return apiRequest(path, { ...options, csrfCookieName: ADMIN_CSRF })
}
