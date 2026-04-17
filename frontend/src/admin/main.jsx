import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { apiRequest } from '../shared/api'
import '../styles.css'

const ADMIN_CSRF = 'mailadmin_csrf_admin'
const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'workspaces', label: 'Workspaces' },
  { key: 'admins', label: 'Admin Users' },
  { key: 'domains', label: 'Domains' },
  { key: 'mailboxes', label: 'Mailboxes' },
  { key: 'aliases', label: 'Aliases' },
]

function AdminApp() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [session, setSession] = useState(null)
  const [summary, setSummary] = useState(null)
  const [message, setMessage] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(false)

  const [workspaceForm, setWorkspaceForm] = useState({ slug: '', name: '', default_domain: '' })
  const [workspaceDomainForm, setWorkspaceDomainForm] = useState({ slug: '', domain: '' })
  const [workspaces, setWorkspaces] = useState([])

  const [adminForm, setAdminForm] = useState({ username: '', password: '', role: 'workspace_admin', active: true })
  const [adminPasswordForm, setAdminPasswordForm] = useState({ username: '', new_password: '' })
  const [bindingForm, setBindingForm] = useState({ username: '', workspace_slug: '', can_read: true, can_write: true, manage_domains: true, manage_mailboxes: true, manage_aliases: true })
  const [adminUsers, setAdminUsers] = useState([])
  const [bindingsByUser, setBindingsByUser] = useState({})

  const [domainForm, setDomainForm] = useState({ domain: '', workspace_slug: '' })
  const [domainWorkspace, setDomainWorkspace] = useState('')
  const [domains, setDomains] = useState([])

  const [mailboxForm, setMailboxForm] = useState({ email: '', password: '' })
  const [mailboxPasswordForm, setMailboxPasswordForm] = useState({ email: '', new_password: '' })
  const [mailboxWorkspace, setMailboxWorkspace] = useState('')
  const [mailboxes, setMailboxes] = useState([])

  const [aliasForm, setAliasForm] = useState({ source: '', destination: '' })
  const [aliasWorkspace, setAliasWorkspace] = useState('')
  const [aliases, setAliases] = useState([])

  const isSuperadmin = session?.role === 'superadmin'

  const withStatus = async (handler, successText) => {
    setMessage(null)
    setLoading(true)
    try {
      await handler()
      setMessage({ kind: 'success', text: successText })
    } catch (error) {
      setMessage({ kind: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  const loadDashboard = async () => {
    const [workspaceRes, domainRes, mailboxRes, aliasRes] = await Promise.all([
      apiRequest('/api/v1/platform/workspaces', { csrfCookieName: ADMIN_CSRF }),
      apiRequest('/api/v1/platform/mail/domains', { csrfCookieName: ADMIN_CSRF }),
      apiRequest('/api/v1/platform/mail/mailboxes', { csrfCookieName: ADMIN_CSRF }),
      apiRequest('/api/v1/platform/mail/aliases', { csrfCookieName: ADMIN_CSRF }),
    ])

    setSummary({
      workspaces: (workspaceRes.items || []).length,
      domains: (domainRes.items || []).length,
      mailboxes: (mailboxRes.items || []).length,
      aliases: (aliasRes.items || []).length,
    })
  }

  const loadWorkspaces = async () => {
    const res = await apiRequest('/api/v1/platform/workspaces', { csrfCookieName: ADMIN_CSRF })
    setWorkspaces(res.items || [])
  }

  const loadAdminUsers = async () => {
    if (!isSuperadmin) {
      setAdminUsers([])
      return
    }
    const res = await apiRequest('/api/v1/platform/admin-users', { csrfCookieName: ADMIN_CSRF })
    setAdminUsers(res.items || [])
  }

  const loadBindings = async (targetUser) => {
    if (!targetUser || !isSuperadmin) return
    const res = await apiRequest(`/api/v1/platform/admin-users/${encodeURIComponent(targetUser)}/workspaces`, { csrfCookieName: ADMIN_CSRF })
    setBindingsByUser((prev) => ({ ...prev, [targetUser]: res.items || [] }))
  }

  const upsertBinding = async () => {
    const targetUser = bindingForm.username.trim()
    const targetWorkspace = bindingForm.workspace_slug.trim()
    if (!targetUser || !targetWorkspace) throw new Error('username 和 workspace_slug 不能为空')

    const currentBindings = bindingsByUser[targetUser]
      || (await apiRequest(`/api/v1/platform/admin-users/${encodeURIComponent(targetUser)}/workspaces`, { csrfCookieName: ADMIN_CSRF })).items
      || []

    const nextBinding = {
      workspace_slug: targetWorkspace,
      can_read: bindingForm.can_read,
      can_write: bindingForm.can_write,
      manage_domains: bindingForm.manage_domains,
      manage_mailboxes: bindingForm.manage_mailboxes,
      manage_aliases: bindingForm.manage_aliases,
    }

    const hasExistingBinding = currentBindings.some((item) => item.workspace_slug === targetWorkspace)
    const mergedBindings = hasExistingBinding
      ? currentBindings.map((item) => (item.workspace_slug === targetWorkspace ? { ...item, ...nextBinding } : item))
      : [...currentBindings, nextBinding]

    await apiRequest(`/api/v1/platform/admin-users/${encodeURIComponent(targetUser)}/workspaces`, {
      method: 'PUT',
      body: { bindings: mergedBindings },
      csrfCookieName: ADMIN_CSRF,
    })
    setBindingsByUser((prev) => ({ ...prev, [targetUser]: mergedBindings }))
  }

  const loadDomains = async (workspace = '') => {
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
    const res = await apiRequest(`/api/v1/platform/mail/domains${query}`, { csrfCookieName: ADMIN_CSRF })
    setDomains(res.items || [])
  }

  const loadMailboxes = async (workspace = '') => {
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
    const res = await apiRequest(`/api/v1/platform/mail/mailboxes${query}`, { csrfCookieName: ADMIN_CSRF })
    setMailboxes(res.items || [])
  }

  const loadAliases = async (workspace = '') => {
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
    const res = await apiRequest(`/api/v1/platform/mail/aliases${query}`, { csrfCookieName: ADMIN_CSRF })
    setAliases(res.items || [])
  }

  const refreshTabData = async (targetTab = tab) => {
    if (!session) return
    if (targetTab === 'dashboard') return loadDashboard()
    if (targetTab === 'workspaces') return loadWorkspaces()
    if (targetTab === 'admins') return loadAdminUsers()
    if (targetTab === 'domains') return loadDomains(domainWorkspace)
    if (targetTab === 'mailboxes') return loadMailboxes(mailboxWorkspace)
    if (targetTab === 'aliases') return loadAliases(aliasWorkspace)
  }

  const onLogin = async (event) => {
    event.preventDefault()
    await withStatus(async () => {
      await apiRequest('/api/v1/platform/auth/login', {
        method: 'POST',
        body: { username, password },
        csrfCookieName: ADMIN_CSRF,
      })
      const sessionData = await apiRequest('/api/v1/platform/auth/session', { csrfCookieName: ADMIN_CSRF })
      setSession(sessionData)
      setPassword('')
      await loadDashboard()
    }, '登录成功')
  }

  const onLogout = async () => {
    await apiRequest('/api/v1/platform/auth/logout', {
      method: 'POST',
      csrfCookieName: ADMIN_CSRF,
    }).catch(() => {})
    setSession(null)
    setSummary(null)
    setWorkspaces([])
    setAdminUsers([])
    setDomains([])
    setMailboxes([])
    setAliases([])
    setBindingsByUser({})
    setMessage(null)
  }

  const workspaceOptions = useMemo(
    () => workspaces.filter((item) => item.active).map((item) => item.slug),
    [workspaces],
  )

  const badgeClass = (active) => active ? 'badge green' : 'badge red'

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <div className="brand">MailOps Platform Console</div>
          <div className="muted">mail.myupona.com · Platform / Workspaces / Mail Control</div>
        </div>
        <div className="toolbar">
          <span className="badge">{session ? `${session.username} · ${session.role}` : '未登录'}</span>
          {session ? <button className="ghost small" onClick={onLogout}>退出</button> : null}
        </div>
      </div>

      {!session ? (
        <div className="card">
          <h2>管理员登录</h2>
          <form className="form-row" onSubmit={onLogin}>
            <div className="span-4"><input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div className="span-4"><input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <div className="span-4"><button disabled={loading}>登录</button></div>
          </form>
          <div className="smalltext">支持 superadmin / workspace_admin，提供 workspace/admin/domain/mailbox/alias 管理能力。</div>
          {message?.text ? <div className={message.kind}>{message.text}</div> : null}
        </div>
      ) : (
        <div className="card">
          <div className="tabs">
            {TABS.map((item) => (
              <button
                key={item.key}
                className={`tab ${tab === item.key ? 'active' : ''}`}
                onClick={() => withStatus(async () => {
                  setTab(item.key)
                  await refreshTabData(item.key)
                }, `已切换到 ${item.label}`)}
                disabled={loading}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'dashboard' ? (
            <>
              <div className="toolbar">
                <h2 style={{ margin: 0 }}>Dashboard</h2>
                <div className="grow" />
                <button className="secondary small" onClick={() => withStatus(loadDashboard, 'Dashboard 已刷新')} disabled={loading}>刷新数据</button>
              </div>
              <div className="kpis" style={{ marginTop: 12 }}>
                <div className="kpi"><div className="muted">Workspaces</div><div className="n">{summary?.workspaces ?? '-'}</div></div>
                <div className="kpi"><div className="muted">Domains</div><div className="n">{summary?.domains ?? '-'}</div></div>
                <div className="kpi"><div className="muted">Mailboxes</div><div className="n">{summary?.mailboxes ?? '-'}</div></div>
                <div className="kpi"><div className="muted">Aliases</div><div className="n">{summary?.aliases ?? '-'}</div></div>
              </div>
            </>
          ) : null}

          {tab === 'workspaces' ? (
            <div className="grid">
              <div className="col-6 card">
                <h3>创建 / 更新 Workspace（superadmin）</h3>
                <form className="form-row" onSubmit={(e) => {
                  e.preventDefault()
                  withStatus(async () => {
                    await apiRequest('/api/v1/platform/workspaces', {
                      method: 'POST',
                      body: workspaceForm,
                      csrfCookieName: ADMIN_CSRF,
                    })
                    await loadWorkspaces()
                    setWorkspaceForm({ slug: '', name: '', default_domain: '' })
                  }, 'Workspace 已保存')
                }}>
                  <div className="span-4"><input placeholder="slug" value={workspaceForm.slug} onChange={(e) => setWorkspaceForm((v) => ({ ...v, slug: e.target.value }))} /></div>
                  <div className="span-4"><input placeholder="name" value={workspaceForm.name} onChange={(e) => setWorkspaceForm((v) => ({ ...v, name: e.target.value }))} /></div>
                  <div className="span-4"><input placeholder="default_domain" value={workspaceForm.default_domain} onChange={(e) => setWorkspaceForm((v) => ({ ...v, default_domain: e.target.value }))} /></div>
                  <div className="span-12"><button disabled={!isSuperadmin || loading}>保存 Workspace</button></div>
                </form>

                <h3 style={{ marginTop: 16 }}>绑定 Domain 到 Workspace（superadmin）</h3>
                <form className="form-row" onSubmit={(e) => {
                  e.preventDefault()
                  withStatus(async () => {
                    await apiRequest(`/api/v1/platform/workspaces/${encodeURIComponent(workspaceDomainForm.slug)}/domains`, {
                      method: 'POST',
                      body: { domain: workspaceDomainForm.domain },
                      csrfCookieName: ADMIN_CSRF,
                    })
                    await loadWorkspaces()
                    setWorkspaceDomainForm({ slug: '', domain: '' })
                  }, 'Domain 已绑定到 Workspace')
                }}>
                  <div className="span-6"><input placeholder="workspace_slug" value={workspaceDomainForm.slug} onChange={(e) => setWorkspaceDomainForm((v) => ({ ...v, slug: e.target.value }))} /></div>
                  <div className="span-6"><input placeholder="domain" value={workspaceDomainForm.domain} onChange={(e) => setWorkspaceDomainForm((v) => ({ ...v, domain: e.target.value }))} /></div>
                  <div className="span-12"><button disabled={!isSuperadmin || loading}>绑定 Domain</button></div>
                </form>
              </div>

              <div className="col-6 card">
                <div className="toolbar">
                  <h3 style={{ margin: 0 }}>Workspace 列表</h3>
                  <div className="grow" />
                  <button className="secondary small" onClick={() => withStatus(loadWorkspaces, 'Workspace 列表已刷新')} disabled={loading}>刷新</button>
                </div>
                <table>
                  <thead>
                    <tr><th>Slug</th><th>Name</th><th>Default Domain</th><th>Domains</th><th>Status</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {workspaces.map((row) => (
                      <tr key={row.slug}>
                        <td>{row.slug}</td>
                        <td>{row.name}</td>
                        <td>{row.default_domain || '-'}</td>
                        <td>{(row.domains || []).join(', ') || '-'}</td>
                        <td><span className={badgeClass(row.active)}>{row.active ? 'active' : 'inactive'}</span></td>
                        <td>
                          <button
                            className="ghost small"
                            disabled={!isSuperadmin || loading}
                            onClick={() => withStatus(async () => {
                              await apiRequest(`/api/v1/platform/workspaces/${encodeURIComponent(row.slug)}/status`, {
                                method: 'PATCH',
                                body: { active: !row.active },
                                csrfCookieName: ADMIN_CSRF,
                              })
                              await loadWorkspaces()
                            }, `Workspace ${row.slug} 状态已更新`)}
                          >切换状态</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === 'admins' ? (
            <div className="grid">
              <div className="col-6 card">
                <h3>创建 / 更新管理员（superadmin）</h3>
                <form className="form-row" onSubmit={(e) => {
                  e.preventDefault()
                  withStatus(async () => {
                    await apiRequest('/api/v1/platform/admin-users', {
                      method: 'POST',
                      body: adminForm,
                      csrfCookieName: ADMIN_CSRF,
                    })
                    await loadAdminUsers()
                    setAdminForm({ username: '', password: '', role: 'workspace_admin', active: true })
                  }, '管理员已保存')
                }}>
                  <div className="span-4"><input placeholder="username" value={adminForm.username} onChange={(e) => setAdminForm((v) => ({ ...v, username: e.target.value }))} /></div>
                  <div className="span-4"><input placeholder="password (new only)" value={adminForm.password} onChange={(e) => setAdminForm((v) => ({ ...v, password: e.target.value }))} /></div>
                  <div className="span-2"><select value={adminForm.role} onChange={(e) => setAdminForm((v) => ({ ...v, role: e.target.value }))}><option value="workspace_admin">workspace_admin</option><option value="superadmin">superadmin</option></select></div>
                  <div className="span-2"><select value={adminForm.active ? '1' : '0'} onChange={(e) => setAdminForm((v) => ({ ...v, active: e.target.value === '1' }))}><option value="1">active</option><option value="0">inactive</option></select></div>
                  <div className="span-12"><button disabled={!isSuperadmin || loading}>保存管理员</button></div>
                </form>

                <h3 style={{ marginTop: 16 }}>重置管理员密码（superadmin）</h3>
                <form className="form-row" onSubmit={(e) => {
                  e.preventDefault()
                  withStatus(async () => {
                    await apiRequest(`/api/v1/platform/admin-users/${encodeURIComponent(adminPasswordForm.username)}/password`, {
                      method: 'POST',
                      body: { new_password: adminPasswordForm.new_password },
                      csrfCookieName: ADMIN_CSRF,
                    })
                    setAdminPasswordForm({ username: '', new_password: '' })
                  }, '管理员密码已更新')
                }}>
                  <div className="span-6"><input placeholder="username" value={adminPasswordForm.username} onChange={(e) => setAdminPasswordForm((v) => ({ ...v, username: e.target.value }))} /></div>
                  <div className="span-6"><input placeholder="new_password" value={adminPasswordForm.new_password} onChange={(e) => setAdminPasswordForm((v) => ({ ...v, new_password: e.target.value }))} /></div>
                  <div className="span-12"><button disabled={!isSuperadmin || loading}>更新密码</button></div>
                </form>

                <h3 style={{ marginTop: 16 }}>绑定管理员 Workspace 权限（superadmin）</h3>
                <form className="form-row" onSubmit={(e) => {
                  e.preventDefault()
                  withStatus(async () => {
                    await upsertBinding()
                  }, '管理员 workspace 绑定已更新')
                }}>
                  <div className="span-6"><input placeholder="username" value={bindingForm.username} onChange={(e) => setBindingForm((v) => ({ ...v, username: e.target.value }))} /></div>
                  <div className="span-6"><input placeholder="workspace_slug" value={bindingForm.workspace_slug} onChange={(e) => setBindingForm((v) => ({ ...v, workspace_slug: e.target.value }))} /></div>
                  <div className="span-12 checkgrid">
                    {['can_read', 'can_write', 'manage_domains', 'manage_mailboxes', 'manage_aliases'].map((name) => (
                      <label key={name} className="badge">
                        <input
                          type="checkbox"
                          checked={bindingForm[name]}
                          onChange={(e) => setBindingForm((v) => ({ ...v, [name]: e.target.checked }))}
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                  <div className="span-12"><button disabled={!isSuperadmin || loading}>写入绑定</button></div>
                </form>
              </div>

              <div className="col-6 card">
                <div className="toolbar">
                  <h3 style={{ margin: 0 }}>管理员列表</h3>
                  <div className="grow" />
                  <button className="secondary small" onClick={() => withStatus(loadAdminUsers, '管理员列表已刷新')} disabled={loading || !isSuperadmin}>刷新</button>
                </div>
                <table>
                  <thead>
                    <tr><th>Username</th><th>Role</th><th>Status</th><th>Bindings</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((row) => (
                      <tr key={row.username}>
                        <td>{row.username}</td>
                        <td>{row.role}</td>
                        <td><span className={badgeClass(row.active)}>{row.active ? 'active' : 'inactive'}</span></td>
                        <td>
                          {(bindingsByUser[row.username] || row.bindings || []).map((b) => (
                            <div key={`${row.username}-${b.workspace_slug}`} className="smalltext">{b.workspace_slug} · R:{String(b.can_read)} W:{String(b.can_write)} D/M/A:{String(b.manage_domains)}/{String(b.manage_mailboxes)}/{String(b.manage_aliases)}</div>
                          ))}
                        </td>
                        <td>
                          <div className="toolbar">
                            <button className="ghost small" disabled={!isSuperadmin || loading} onClick={() => withStatus(() => loadBindings(row.username), '管理员绑定已加载')}>查看绑定</button>
                            <button
                              className="ghost small"
                              disabled={!isSuperadmin || loading}
                              onClick={() => withStatus(async () => {
                                await apiRequest(`/api/v1/platform/admin-users/${encodeURIComponent(row.username)}/status`, {
                                  method: 'PATCH',
                                  body: { active: !row.active },
                                  csrfCookieName: ADMIN_CSRF,
                                })
                                await loadAdminUsers()
                              }, `管理员 ${row.username} 状态已更新`)}
                            >切换状态</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === 'domains' ? (
            <>
              <div className="toolbar">
                <h3 style={{ margin: 0 }}>Domain 管理</h3>
                <select style={{ width: 220 }} value={domainWorkspace} onChange={(e) => setDomainWorkspace(e.target.value)}>
                  <option value="">全部 workspace</option>
                  {workspaceOptions.map((slug) => <option key={slug} value={slug}>{slug}</option>)}
                </select>
                <button className="secondary small" onClick={() => withStatus(() => loadDomains(domainWorkspace), 'Domain 列表已刷新')} disabled={loading}>刷新</button>
              </div>
              <form className="form-row" onSubmit={(e) => {
                e.preventDefault()
                withStatus(async () => {
                  await apiRequest('/api/v1/platform/mail/domains', {
                    method: 'POST',
                    body: domainForm,
                    csrfCookieName: ADMIN_CSRF,
                  })
                  setDomainForm({ domain: '', workspace_slug: '' })
                  await loadDomains(domainWorkspace)
                }, 'Domain 已保存')
              }}>
                <div className="span-6"><input placeholder="domain" value={domainForm.domain} onChange={(e) => setDomainForm((v) => ({ ...v, domain: e.target.value }))} /></div>
                <div className="span-6"><input placeholder="workspace_slug (superadmin only)" value={domainForm.workspace_slug} onChange={(e) => setDomainForm((v) => ({ ...v, workspace_slug: e.target.value }))} /></div>
                <div className="span-12"><button disabled={loading}>创建 / 激活 Domain</button></div>
              </form>
              <table>
                <thead><tr><th>Domain</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {domains.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td><span className={badgeClass(row.active !== false)}>{row.active === false ? 'inactive' : 'active'}</span></td>
                      <td><button className="ghost small" disabled={loading} onClick={() => withStatus(async () => {
                        await apiRequest(`/api/v1/platform/mail/domains/${encodeURIComponent(row.name)}/status`, {
                          method: 'PATCH',
                          body: { active: row.active === false },
                          csrfCookieName: ADMIN_CSRF,
                        })
                        await loadDomains(domainWorkspace)
                      }, `Domain ${row.name} 状态已更新`)}>切换状态</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {tab === 'mailboxes' ? (
            <>
              <div className="toolbar">
                <h3 style={{ margin: 0 }}>Mailbox 管理</h3>
                <select style={{ width: 220 }} value={mailboxWorkspace} onChange={(e) => setMailboxWorkspace(e.target.value)}>
                  <option value="">全部 workspace</option>
                  {workspaceOptions.map((slug) => <option key={slug} value={slug}>{slug}</option>)}
                </select>
                <button className="secondary small" onClick={() => withStatus(() => loadMailboxes(mailboxWorkspace), 'Mailbox 列表已刷新')} disabled={loading}>刷新</button>
              </div>

              <form className="form-row" onSubmit={(e) => {
                e.preventDefault()
                withStatus(async () => {
                  await apiRequest('/api/v1/platform/mail/mailboxes', {
                    method: 'POST',
                    body: mailboxForm,
                    csrfCookieName: ADMIN_CSRF,
                  })
                  setMailboxForm({ email: '', password: '' })
                  await loadMailboxes(mailboxWorkspace)
                }, 'Mailbox 已创建')
              }}>
                <div className="span-6"><input placeholder="email" value={mailboxForm.email} onChange={(e) => setMailboxForm((v) => ({ ...v, email: e.target.value }))} /></div>
                <div className="span-6"><input placeholder="password" value={mailboxForm.password} onChange={(e) => setMailboxForm((v) => ({ ...v, password: e.target.value }))} /></div>
                <div className="span-12"><button disabled={loading}>创建 Mailbox</button></div>
              </form>

              <form className="form-row" onSubmit={(e) => {
                e.preventDefault()
                withStatus(async () => {
                  await apiRequest(`/api/v1/platform/mail/mailboxes/${encodeURIComponent(mailboxPasswordForm.email)}/password`, {
                    method: 'POST',
                    body: { new_password: mailboxPasswordForm.new_password },
                    csrfCookieName: ADMIN_CSRF,
                  })
                  setMailboxPasswordForm({ email: '', new_password: '' })
                }, 'Mailbox 密码已更新')
              }}>
                <div className="span-6"><input placeholder="email" value={mailboxPasswordForm.email} onChange={(e) => setMailboxPasswordForm((v) => ({ ...v, email: e.target.value }))} /></div>
                <div className="span-6"><input placeholder="new_password" value={mailboxPasswordForm.new_password} onChange={(e) => setMailboxPasswordForm((v) => ({ ...v, new_password: e.target.value }))} /></div>
                <div className="span-12"><button className="secondary" disabled={loading}>更新 Mailbox 密码</button></div>
              </form>

              <table>
                <thead><tr><th>Email</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {mailboxes.map((row) => (
                    <tr key={row.email}>
                      <td>{row.email}</td>
                      <td><span className={badgeClass(row.active !== false)}>{row.active === false ? 'inactive' : 'active'}</span></td>
                      <td>
                        <div className="toolbar">
                          <button className="ghost small" disabled={loading} onClick={() => withStatus(async () => {
                            await apiRequest(`/api/v1/platform/mail/mailboxes/${encodeURIComponent(row.email)}/status`, {
                              method: 'PATCH',
                              body: { active: row.active === false },
                              csrfCookieName: ADMIN_CSRF,
                            })
                            await loadMailboxes(mailboxWorkspace)
                          }, `Mailbox ${row.email} 状态已更新`)}>切换状态</button>
                          <button className="danger small" disabled={loading} onClick={() => withStatus(async () => {
                            await apiRequest(`/api/v1/platform/mail/mailboxes/${encodeURIComponent(row.email)}`, {
                              method: 'DELETE',
                              csrfCookieName: ADMIN_CSRF,
                            })
                            await loadMailboxes(mailboxWorkspace)
                          }, `Mailbox ${row.email} 已删除`)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {tab === 'aliases' ? (
            <>
              <div className="toolbar">
                <h3 style={{ margin: 0 }}>Alias 管理</h3>
                <select style={{ width: 220 }} value={aliasWorkspace} onChange={(e) => setAliasWorkspace(e.target.value)}>
                  <option value="">全部 workspace</option>
                  {workspaceOptions.map((slug) => <option key={slug} value={slug}>{slug}</option>)}
                </select>
                <button className="secondary small" onClick={() => withStatus(() => loadAliases(aliasWorkspace), 'Alias 列表已刷新')} disabled={loading}>刷新</button>
              </div>

              <form className="form-row" onSubmit={(e) => {
                e.preventDefault()
                withStatus(async () => {
                  await apiRequest('/api/v1/platform/mail/aliases', {
                    method: 'POST',
                    body: aliasForm,
                    csrfCookieName: ADMIN_CSRF,
                  })
                  setAliasForm({ source: '', destination: '' })
                  await loadAliases(aliasWorkspace)
                }, 'Alias 已保存')
              }}>
                <div className="span-6"><input placeholder="source" value={aliasForm.source} onChange={(e) => setAliasForm((v) => ({ ...v, source: e.target.value }))} /></div>
                <div className="span-6"><input placeholder="destination" value={aliasForm.destination} onChange={(e) => setAliasForm((v) => ({ ...v, destination: e.target.value }))} /></div>
                <div className="span-12"><button disabled={loading}>创建 / 更新 Alias</button></div>
              </form>

              <table>
                <thead><tr><th>Source</th><th>Destination</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {aliases.map((row) => (
                    <tr key={row.source}>
                      <td>{row.source}</td>
                      <td>{row.destination}</td>
                      <td><span className={badgeClass(row.active !== false)}>{row.active === false ? 'inactive' : 'active'}</span></td>
                      <td>
                        <div className="toolbar">
                          <button className="ghost small" disabled={loading} onClick={() => withStatus(async () => {
                            await apiRequest(`/api/v1/platform/mail/aliases/${encodeURIComponent(row.source)}/status`, {
                              method: 'PATCH',
                              body: { active: row.active === false },
                              csrfCookieName: ADMIN_CSRF,
                            })
                            await loadAliases(aliasWorkspace)
                          }, `Alias ${row.source} 状态已更新`)}>切换状态</button>
                          <button className="danger small" disabled={loading} onClick={() => withStatus(async () => {
                            await apiRequest(`/api/v1/platform/mail/aliases/${encodeURIComponent(row.source)}`, {
                              method: 'DELETE',
                              csrfCookieName: ADMIN_CSRF,
                            })
                            await loadAliases(aliasWorkspace)
                          }, `Alias ${row.source} 已删除`)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {message?.text ? <div className={message.kind} style={{ marginTop: 12 }}>{message.text}</div> : null}
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<AdminApp />)
