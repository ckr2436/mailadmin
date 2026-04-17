const qs = (s, el = document) => el.querySelector(s);

function csrfToken() {
  const pair = document.cookie.split('; ').find((v) => v.startsWith('mailadmin_csrf_portal='));
  return pair ? decodeURIComponent(pair.split('=').slice(1).join('=')) : '';
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : {}),
      ...(csrfToken() ? { 'X-CSRF-Token': csrfToken() } : {}),
      ...(opts.headers || {}),
    },
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.message || data?.error?.code || data?.code || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function showBox(id, kind, msg) {
  const el = qs(id);
  if (!el) return;
  el.className = kind;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideBox(id) {
  const el = qs(id);
  if (el) el.classList.add('hidden');
}

function clearMailState() {
  sessionStorage.removeItem('mail.webmailToken');
  sessionStorage.removeItem('mail.mailboxEmail');
  sessionStorage.removeItem('mail.workspaceSlug');
  sessionStorage.removeItem('mail.workspaceDomain');
  sessionStorage.removeItem('mail.workspaceByDomain');
}

function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  if (at < 0) return '';
  return String(email).slice(at + 1).trim().toLowerCase();
}

function pickWorkspaceByDomain(workspaces, domain) {
  const normalizedDomain = String(domain || '').toLowerCase();
  if (!normalizedDomain) return '';
  const matches = (ws) => {
    const defaultDomain = String(ws.default_domain || '').toLowerCase();
    const domains = Array.isArray(ws.domains) ? ws.domains.map((d) => String(d || '').toLowerCase()) : [];
    return defaultDomain === normalizedDomain || domains.includes(normalizedDomain);
  };
  const found = (workspaces || []).find(matches);
  return found?.slug || '';
}

function getWorkspaceDomainCache() {
  try {
    const raw = sessionStorage.getItem('mail.workspaceByDomain');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function setWorkspaceDomainCache(domain, slug) {
  if (!domain || !slug) return;
  const cache = getWorkspaceDomainCache();
  cache[domain] = slug;
  sessionStorage.setItem('mail.workspaceByDomain', JSON.stringify(cache));
}

async function resolveWorkspaceSlug(email) {
  const domain = emailDomain(email);
  if (!domain) return 'default';
  const byDomain = getWorkspaceDomainCache();
  if (byDomain[domain]) return byDomain[domain];
  const legacyCached = sessionStorage.getItem('mail.workspaceSlug') || '';
  const legacyDomain = sessionStorage.getItem('mail.workspaceDomain') || '';
  if (legacyCached && legacyDomain && legacyDomain === domain) return legacyCached;
  try {
    const data = await api('/api/v1/tenants');
    const items = Array.isArray(data?.items) ? data.items : [];
    const matched = pickWorkspaceByDomain(items, domain);
    if (matched) {
      setWorkspaceDomainCache(domain, matched);
      return matched;
    }
    if (items.length === 1 && items[0]?.slug) {
      setWorkspaceDomainCache(domain, items[0].slug);
      return items[0].slug;
    }
  } catch (_) {
    // Fall back to default workspace when tenant discovery is unavailable.
  }
  setWorkspaceDomainCache(domain, 'default');
  return 'default';
}

async function logoutToLogin() {
  await api('/api/v1/portal/auth/logout', { method: 'POST' }).catch(() => {});
  clearMailState();
  location.href = '/';
}

async function handleLoginPage() {
  const btn = qs('#mailLoginSubmit');
  if (!btn) return;
  btn.onclick = async () => {
    hideBox('#mailLoginMsg');
    const email = (qs('#mailLoginEmail')?.value || '').trim();
    const password = qs('#mailLoginPassword')?.value || '';
    if (!email || !password) {
      showBox('#mailLoginMsg', 'error', 'Please enter your email address and password.');
      return;
    }
    try {
      const workspaceSlug = await resolveWorkspaceSlug(email);
      await api('/api/v1/portal/auth/login', {
        method: 'POST',
        headers: { 'X-Workspace-Slug': workspaceSlug },
        body: JSON.stringify({ email, password }),
      });
      const connected = await api('/api/v1/portal/webmail/connect', { method: 'POST', body: JSON.stringify({ password }) });
      const webmailToken = connected.webmail_token || '';
      if (!webmailToken) throw new Error('Failed to initialize mailbox session.');
      sessionStorage.setItem('mail.webmailToken', webmailToken);
      sessionStorage.setItem('mail.mailboxEmail', email);
      sessionStorage.setItem('mail.workspaceSlug', workspaceSlug);
      sessionStorage.setItem('mail.workspaceDomain', emailDomain(email));
      setWorkspaceDomainCache(emailDomain(email), workspaceSlug);
      qs('#mailLoginPassword').value = '';
      location.href = '/mail/';
    } catch (e) {
      showBox('#mailLoginMsg', 'error', e.message);
    }
  };
}

function renderProfile(profile) {
  qs('#mailProfile').innerHTML = `
    <div class="list-item"><b>Email</b><div>${escapeHtml(profile.email || '')}</div></div>
    <div class="list-item"><b>Workspace</b><div>${escapeHtml(profile.workspace_slug || '')}</div></div>
    <div class="list-item"><b>Domain</b><div>${escapeHtml(profile.domain || '')}</div></div>
    <div class="list-item"><b>Status</b><div>${profile.active ? '<span class="badge green">active</span>' : '<span class="badge red">disabled</span>'}</div></div>
  `;
}

function renderAliases(items) {
  const host = qs('#mailAliases');
  if (!host) return;
  host.innerHTML = items.length
    ? items.map((x) => `<div class="list-item"><b>${escapeHtml(x.source || '')}</b><div class="smalltext">→ ${escapeHtml(x.destination || '')}</div></div>`).join('')
    : '<div class="muted">No aliases</div>';
}

function renderInbox(items) {
  const host = qs('#mailInboxList');
  if (!host) return;
  if (!items.length) {
    host.innerHTML = '<div class="muted">No messages</div>';
    return;
  }
  host.innerHTML = items.map((item) => `<button class="mail-item" data-uid="${escapeHtml(item.uid)}">
      <div class="mail-item-subject">${escapeHtml(item.subject || '(No subject)')}</div>
      <div class="mail-item-meta">${escapeHtml(item.from || '')}</div>
      <div class="mail-item-preview">${escapeHtml(item.preview || '')}</div>
    </button>`).join('');
  host.querySelectorAll('[data-uid]').forEach((el) => {
    el.onclick = () => loadMessage(el.dataset.uid);
  });
}

function sessionExpired() {
  showBox('#mailTopMsg', 'error', 'Session expired. Please sign in again.');
  setTimeout(() => { location.href = '/'; }, 700);
}

function getWebmailToken() {
  return sessionStorage.getItem('mail.webmailToken') || '';
}

async function loadMessage(uid) {
  const token = getWebmailToken();
  try {
    const data = await api(`/api/v1/portal/webmail/messages/${encodeURIComponent(uid)}`, { authToken: token });
    const m = data.item || {};
    qs('#mailViewer').classList.remove('muted');
    qs('#mailViewer').innerHTML = `
      <div class="mail-viewer-meta"><b>${escapeHtml(m.subject || '(No subject)')}</b></div>
      <div class="mail-viewer-meta">From: ${escapeHtml(m.from || '')}</div>
      <div class="mail-viewer-meta">Date: ${escapeHtml(m.date || '')}</div>
      <hr/>
      <pre class="mail-body">${escapeHtml(m.body || '')}</pre>
    `;
  } catch (e) {
    if (e.status === 401) return sessionExpired();
    showBox('#mailTopMsg', 'error', e.message);
  }
}

async function loadInbox() {
  const token = getWebmailToken();
  if (!token) return sessionExpired();
  try {
    hideBox('#mailTopMsg');
    const data = await api('/api/v1/portal/webmail/inbox?limit=20', { authToken: token });
    renderInbox(data.items || []);
  } catch (e) {
    if (e.status === 401) return sessionExpired();
    showBox('#mailTopMsg', 'error', e.message);
  }
}

async function loadMailApp() {
  if (!qs('#mailBtnLogout')) return;
  try {
    const session = await api('/api/v1/portal/auth/session');
    const token = getWebmailToken();
    if (!token) return sessionExpired();
    qs('#mailSessionBadge').textContent = `${session.email || session.subject || ''} · ${session.workspace_slug || ''}`;
    const [profileData, aliasesData] = await Promise.all([
      api('/api/v1/portal/account/profile'),
      api('/api/v1/portal/account/aliases'),
    ]);
    renderProfile(profileData.profile || {});
    renderAliases(aliasesData.items || []);
    await loadInbox();
  } catch (e) {
    location.href = '/';
    return;
  }

  qs('#mailBtnRefresh').onclick = loadInbox;
  qs('#mailBtnLogout').onclick = logoutToLogin;

  qs('#mailBtnSend').onclick = async () => {
    hideBox('#mailComposeMsg');
    try {
      const token = getWebmailToken();
      await api('/api/v1/portal/webmail/send', {
        method: 'POST',
        authToken: token,
        body: JSON.stringify({
          to: qs('#mailComposeTo').value.trim(),
          subject: qs('#mailComposeSubject').value.trim(),
          body: qs('#mailComposeBody').value,
        }),
      });
      qs('#mailComposeSubject').value = '';
      qs('#mailComposeBody').value = '';
      showBox('#mailComposeMsg', 'success', 'Message sent.');
      await loadInbox();
    } catch (e) {
      if (e.status === 401) return sessionExpired();
      showBox('#mailComposeMsg', 'error', e.message);
    }
  };

  qs('#mailBtnPassword').onclick = async () => {
    hideBox('#mailPwdMsg');
    try {
      await api('/api/v1/portal/account/password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: qs('#mailCurrentPassword').value,
          new_password: qs('#mailNewPassword').value,
        }),
      });
      clearMailState();
      showBox('#mailPwdMsg', 'success', 'Password updated. Please sign in again.');
      setTimeout(() => { logoutToLogin(); }, 500);
    } catch (e) {
      showBox('#mailPwdMsg', 'error', e.message);
    }
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  await handleLoginPage();
  await loadMailApp();
});
