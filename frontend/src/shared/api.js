import { getCookieValue } from './csrf'

export async function apiRequest(path, options = {}) {
  const {
    method,
    body,
    headers = {},
    authToken,
    csrfCookieName,
  } = options

  const csrfToken = getCookieValue(csrfCookieName)
  const response = await fetch(path, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
  })

  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text()

  if (!response.ok) {
    const error = new Error(
      data?.error?.message ||
      data?.message ||
      data?.error?.code ||
      data?.code ||
      'Request failed',
    )
    error.status = response.status
    throw error
  }

  return data
}
