const KEY = {
  WEBMAIL_TOKEN: 'mail.webmailToken',
  MAILBOX_EMAIL: 'mail.mailboxEmail',
  WORKSPACE_SLUG: 'mail.workspaceSlug',
  WORKSPACE_DOMAIN: 'mail.workspaceDomain',
  WORKSPACE_BY_DOMAIN: 'mail.workspaceByDomain',
}

export function getWebmailToken() {
  return sessionStorage.getItem(KEY.WEBMAIL_TOKEN) || ''
}

export function setWebmailToken(token) {
  sessionStorage.setItem(KEY.WEBMAIL_TOKEN, token)
}

export function clearPortalSession() {
  Object.values(KEY).forEach((item) => sessionStorage.removeItem(item))
}

export function setMailboxContext({ email, workspaceSlug, domain }) {
  if (email) sessionStorage.setItem(KEY.MAILBOX_EMAIL, email)
  if (workspaceSlug) sessionStorage.setItem(KEY.WORKSPACE_SLUG, workspaceSlug)
  if (domain) sessionStorage.setItem(KEY.WORKSPACE_DOMAIN, domain)
}

export function getWorkspaceByDomainCache() {
  try {
    const raw = sessionStorage.getItem(KEY.WORKSPACE_BY_DOMAIN)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function setWorkspaceByDomain(domain, slug) {
  if (!domain || !slug) return
  const cache = getWorkspaceByDomainCache()
  cache[domain] = slug
  sessionStorage.setItem(KEY.WORKSPACE_BY_DOMAIN, JSON.stringify(cache))
}
