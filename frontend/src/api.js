function csrfToken(cookieName) {
  if (!cookieName) return ''
  const name = document.cookie.split('; ').find((v) => v.startsWith(`${cookieName}=`))
  return name ? decodeURIComponent(name.split('=').slice(1).join('=')) : ''
}

export async function api(path, opts = {}, csrfCookieName = '') {
  const token = csrfToken(csrfCookieName)
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}), ...(opts.headers || {}) },
    ...opts,
  })
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('application/json') ? await res.json() : await res.text()
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || data?.error?.code || data?.code || 'Request failed')
  }
  return data
}
