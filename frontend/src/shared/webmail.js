import { apiRequest } from './api'
import { clearPortalSession } from './session'

const PORTAL_CSRF = 'mailadmin_csrf_portal'

export function handleSessionExpired() {
  clearPortalSession()
  window.location.href = '/'
}

export async function getMailSession() {
  return apiRequest('/api/v1/mail/auth/session', { csrfCookieName: PORTAL_CSRF })
}

export async function getMailAccounts() {
  return apiRequest('/api/v1/mail/accounts', { csrfCookieName: PORTAL_CSRF })
}

export async function connectMailbox(payload) {
  return apiRequest('/api/v1/mail/accounts', {
    method: 'POST',
    body: payload,
    csrfCookieName: PORTAL_CSRF,
  })
}

export async function disconnectMailbox(accountId) {
  return apiRequest(`/api/v1/mail/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    csrfCookieName: PORTAL_CSRF,
  })
}

export async function getInbox(account = 'all', limit = 50) {
  return apiRequest(`/api/v1/mail/inbox?account=${encodeURIComponent(account)}&limit=${limit}`, { csrfCookieName: PORTAL_CSRF })
}

export async function getMessage(accountId, uid, folder = 'INBOX') {
  return apiRequest(`/api/v1/mail/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folder)}/messages/${encodeURIComponent(uid)}`, { csrfCookieName: PORTAL_CSRF })
}

export async function sendMessage(payload) {
  return apiRequest('/api/v1/mail/send', {
    method: 'POST',
    body: payload,
    csrfCookieName: PORTAL_CSRF,
  })
}

export async function logoutMailSession() {
  await apiRequest('/api/v1/mail/auth/logout', {
    method: 'POST',
    csrfCookieName: PORTAL_CSRF,
  }).catch(() => {})
  clearPortalSession()
}
