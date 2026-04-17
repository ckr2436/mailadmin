import { apiRequest } from './api'
import {
  clearPortalSession,
  setMailboxContext,
  setWebmailToken,
  getWorkspaceByDomainCache,
  setWorkspaceByDomain,
} from './session'

const PORTAL_CSRF = 'mailadmin_csrf_portal'

function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@')
  if (at < 0) return ''
  return String(email).slice(at + 1).trim().toLowerCase()
}

function pickWorkspaceByDomain(workspaces, domain) {
  const normalizedDomain = String(domain || '').toLowerCase()
  if (!normalizedDomain) return ''

  const matches = (workspace) => {
    const defaultDomain = String(workspace.default_domain || '').toLowerCase()
    const domains = Array.isArray(workspace.domains)
      ? workspace.domains.map((item) => String(item || '').toLowerCase())
      : []
    return defaultDomain === normalizedDomain || domains.includes(normalizedDomain)
  }

  return (workspaces || []).find(matches)?.slug || ''
}

export async function resolveWorkspaceSlug(email) {
  const domain = emailDomain(email)
  if (!domain) return 'default'

  const cache = getWorkspaceByDomainCache()
  if (cache[domain]) return cache[domain]

  try {
    const data = await apiRequest('/api/v1/tenants')
    const workspaces = Array.isArray(data?.items) ? data.items : []
    const matched = pickWorkspaceByDomain(workspaces, domain)
    if (matched) {
      setWorkspaceByDomain(domain, matched)
      return matched
    }
    if (workspaces.length === 1 && workspaces[0]?.slug) {
      setWorkspaceByDomain(domain, workspaces[0].slug)
      return workspaces[0].slug
    }
  } catch {
    // fallback to default workspace
  }

  setWorkspaceByDomain(domain, 'default')
  return 'default'
}

export async function loginAndConnect({ email, password }) {
  const workspaceSlug = await resolveWorkspaceSlug(email)

  await apiRequest('/api/v1/portal/auth/login', {
    method: 'POST',
    headers: { 'X-Workspace-Slug': workspaceSlug },
    body: { email, password },
    csrfCookieName: PORTAL_CSRF,
  })

  const connected = await apiRequest('/api/v1/portal/webmail/connect', {
    method: 'POST',
    body: { password },
    csrfCookieName: PORTAL_CSRF,
  })

  const token = connected.webmail_token || ''
  if (!token) {
    throw new Error('Failed to initialize mailbox session.')
  }

  const domain = emailDomain(email)
  setWebmailToken(token)
  setMailboxContext({ email, workspaceSlug, domain })
  setWorkspaceByDomain(domain, workspaceSlug)
}

export async function logoutPortal() {
  await apiRequest('/api/v1/portal/auth/logout', {
    method: 'POST',
    csrfCookieName: PORTAL_CSRF,
  }).catch(() => {})
  clearPortalSession()
}
