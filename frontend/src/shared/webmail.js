import { apiRequest } from './api'
import { getWebmailToken, clearPortalSession } from './session'

const PORTAL_CSRF = 'mailadmin_csrf_portal'

function requireToken() {
  const token = getWebmailToken()
  if (!token) {
    const error = new Error('Session expired')
    error.status = 401
    throw error
  }
  return token
}

export function handleSessionExpired() {
  clearPortalSession()
  window.location.href = '/'
}

export async function getPortalSession() {
  return apiRequest('/api/v1/portal/auth/session', { csrfCookieName: PORTAL_CSRF })
}

export async function getProfile() {
  return apiRequest('/api/v1/portal/account/profile', { csrfCookieName: PORTAL_CSRF })
}

export async function getAliases() {
  return apiRequest('/api/v1/portal/account/aliases', { csrfCookieName: PORTAL_CSRF })
}

export async function getInbox(limit = 20) {
  return apiRequest(`/api/v1/portal/webmail/inbox?limit=${limit}`, {
    authToken: requireToken(),
    csrfCookieName: PORTAL_CSRF,
  })
}

export async function getMessage(uid) {
  return apiRequest(`/api/v1/portal/webmail/messages/${encodeURIComponent(uid)}`, {
    authToken: requireToken(),
    csrfCookieName: PORTAL_CSRF,
  })
}

export async function sendMessage(payload) {
  return apiRequest('/api/v1/portal/webmail/send', {
    method: 'POST',
    authToken: requireToken(),
    body: payload,
    csrfCookieName: PORTAL_CSRF,
  })
}

export async function updatePassword(payload) {
  return apiRequest('/api/v1/portal/account/password', {
    method: 'POST',
    body: payload,
    csrfCookieName: PORTAL_CSRF,
  })
}
