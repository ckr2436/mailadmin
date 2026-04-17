import React, { useMemo, useState } from 'react'
import { useAdminSession } from './hooks/useAdminSession'
import { useDashboardSummary } from './hooks/useDashboardSummary'
import { useWorkspaces } from './hooks/useWorkspaces'
import { useAdminUsers } from './hooks/useAdminUsers'
import { useAdminBindings } from './hooks/useAdminBindings'
import { useDomains } from './hooks/useDomains'
import { useMailboxes } from './hooks/useMailboxes'
import { useAliases } from './hooks/useAliases'
import { useAdminLogin } from './mutations/useAdminLogin'
import { useAdminLogout } from './mutations/useAdminLogout'
import { useSaveWorkspace } from './mutations/useSaveWorkspace'
import { useBindWorkspaceDomain } from './mutations/useBindWorkspaceDomain'
import { useToggleWorkspaceStatus } from './mutations/useToggleWorkspaceStatus'
import { useSaveAdminUser } from './mutations/useSaveAdminUser'
import { useResetAdminPassword } from './mutations/useResetAdminPassword'
import { useSaveAdminBindings } from './mutations/useSaveAdminBindings'
import { useToggleAdminStatus } from './mutations/useToggleAdminStatus'
import { useSaveDomain } from './mutations/useSaveDomain'
import { useToggleDomainStatus } from './mutations/useToggleDomainStatus'
import { useCreateMailbox } from './mutations/useCreateMailbox'
import { useResetMailboxPassword } from './mutations/useResetMailboxPassword'
import { useToggleMailboxStatus } from './mutations/useToggleMailboxStatus'
import { useDeleteMailbox } from './mutations/useDeleteMailbox'
import { useSaveAlias } from './mutations/useSaveAlias'
import { useToggleAliasStatus } from './mutations/useToggleAliasStatus'
import { useDeleteAlias } from './mutations/useDeleteAlias'

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'workspaces', label: 'Workspaces' },
  { key: 'admins', label: 'Admin Users' },
  { key: 'domains', label: 'Domains' },
  { key: 'mailboxes', label: 'Mailboxes' },
  { key: 'aliases', label: 'Aliases' },
]

export function AdminApp() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [tab, setTab] = useState('dashboard')

  const [workspaceForm, setWorkspaceForm] = useState({ slug: '', name: '', default_domain: '' })
  const [workspaceDomainForm, setWorkspaceDomainForm] = useState({ slug: '', domain: '' })

  const [adminForm, setAdminForm] = useState({ username: '', password: '', role: 'workspace_admin', active: true })
  const [adminPasswordForm, setAdminPasswordForm] = useState({ username: '', new_password: '' })
  const [bindingForm, setBindingForm] = useState({ username: '', workspace_slug: '', can_read: true, can_write: true, manage_domains: true, manage_mailboxes: true, manage_aliases: true })
  const [bindingLookupUser, setBindingLookupUser] = useState('')

  const [domainForm, setDomainForm] = useState({ domain: '', workspace_slug: '' })
  const [domainWorkspace, setDomainWorkspace] = useState('')

  const [mailboxForm, setMailboxForm] = useState({ email: '', password: '' })
  const [mailboxPasswordForm, setMailboxPasswordForm] = useState({ email: '', new_password: '' })
  const [mailboxWorkspace, setMailboxWorkspace] = useState('')

  const [aliasForm, setAliasForm] = useState({ source: '', destination: '' })
  const [aliasWorkspace, setAliasWorkspace] = useState('')

  const { data: session = null, isLoading: sessionLoading } = useAdminSession()
  const isSuperadmin = session?.role === 'superadmin'
  const authenticated = Boolean(session)

  const dashboardQuery = useDashboardSummary(authenticated && tab === 'dashboard')
  const workspacesQuery = useWorkspaces(authenticated)
  const adminUsersQuery = useAdminUsers(authenticated && isSuperadmin && tab === 'admins')
  const bindingsQuery = useAdminBindings(bindingLookupUser, authenticated && isSuperadmin && tab === 'admins')
  const domainsQuery = useDomains(domainWorkspace, authenticated && tab === 'domains')
  const mailboxesQuery = useMailboxes(mailboxWorkspace, authenticated && tab === 'mailboxes')
  const aliasesQuery = useAliases(aliasWorkspace, authenticated && tab === 'aliases')

  const loginMutation = useAdminLogin()
  const logoutMutation = useAdminLogout()
  const saveWorkspaceMutation = useSaveWorkspace()
  const bindWorkspaceDomainMutation = useBindWorkspaceDomain()
  const toggleWorkspaceStatusMutation = useToggleWorkspaceStatus()
  const saveAdminUserMutation = useSaveAdminUser()
  const resetAdminPasswordMutation = useResetAdminPassword()
  const saveAdminBindingsMutation = useSaveAdminBindings()
  const toggleAdminStatusMutation = useToggleAdminStatus()
  const saveDomainMutation = useSaveDomain()
  const toggleDomainStatusMutation = useToggleDomainStatus()
  const createMailboxMutation = useCreateMailbox()
  const resetMailboxPasswordMutation = useResetMailboxPassword()
  const toggleMailboxStatusMutation = useToggleMailboxStatus()
  const deleteMailboxMutation = useDeleteMailbox()
  const saveAliasMutation = useSaveAlias()
  const toggleAliasStatusMutation = useToggleAliasStatus()
  const deleteAliasMutation = useDeleteAlias()

  const workspaces = workspacesQuery.data || []
  const adminUsers = adminUsersQuery.data || []
  const domains = domainsQuery.data || []
  const mailboxes = mailboxesQuery.data || []
  const aliases = aliasesQuery.data || []

  const workspaceOptions = useMemo(
    () => workspaces.filter((item) => item.active).map((item) => item.slug),
    [workspaces],
  )

  const badgeClass = (active) => (active ? 'badge green' : 'badge red')
  const renderQueryError = (query) => query.error ? <div className="error">{query.error.message}</div> : null

  const onLogin = async (event) => {
    event.preventDefault()
    setMessage(null)
    try {
      await loginMutation.mutateAsync({ username, password })
      setPassword('')
      setMessage({ kind: 'success', text: '登录成功' })
    } catch (error) {
      setMessage({ kind: 'error', text: error.message })
    }
  }

  const onLogout = async () => {
    setMessage(null)
    try {
      await logoutMutation.mutateAsync()
    } catch {
      // ignore logout transport failures
    }
  }

  if (sessionLoading) {
    return <div className="wrap"><div className="card">Loading session...</div></div>
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <div className="brand">MailOps Platform Console</div>
          <div className="muted">mail.myupona.com · Platform / Workspaces / Mail Control</div>
        </div>
        <div className="toolbar">
          <span className="badge">{session ? `${session.username} · ${session.role}` : '未登录'}</span>
          {session ? <button className="ghost small" onClick={onLogout} disabled={logoutMutation.isPending}>退出</button> : null}
        </div>
      </div>

      {!session ? (
        <div className="card">
          <h2>管理员登录</h2>
          <form className="form-row" onSubmit={onLogin}>
            <div className="span-4"><input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div className="span-4"><input type="password" autoComplete="current-password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <div className="span-4"><button disabled={loginMutation.isPending}>登录</button></div>
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
                onClick={() => {
                  setTab(item.key)
                  setMessage(null)
                }}
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
                <button className="secondary small" onClick={() => dashboardQuery.refetch()} disabled={dashboardQuery.isFetching}>刷新数据</button>
              </div>
              {dashboardQuery.isLoading ? <div className="smalltext">Loading dashboard...</div> : null}
              {renderQueryError(dashboardQuery)}
              <div className="kpis" style={{ marginTop: 12 }}>
                <div className="kpi"><div className="muted">Workspaces</div><div className="n">{dashboardQuery.data?.workspaces ?? '-'}</div></div>
                <div className="kpi"><div className="muted">Domains</div><div className="n">{dashboardQuery.data?.domains ?? '-'}</div></div>
                <div className="kpi"><div className="muted">Mailboxes</div><div className="n">{dashboardQuery.data?.mailboxes ?? '-'}</div></div>
                <div className="kpi"><div className="muted">Aliases</div><div className="n">{dashboardQuery.data?.aliases ?? '-'}</div></div>
              </div>
            </>
          ) : null}

          {tab === 'workspaces' ? (
            <div className="grid">
              <div className="col-6 card">
                <h3>创建 / 更新 Workspace（superadmin）</h3>
                <form className="form-row" onSubmit={async (e) => {
                  e.preventDefault()
                  setMessage(null)
                  try {
                    await saveWorkspaceMutation.mutateAsync(workspaceForm)
                    setWorkspaceForm({ slug: '', name: '', default_domain: '' })
                    setMessage({ kind: 'success', text: 'Workspace 已保存' })
                  } catch (error) {
                    setMessage({ kind: 'error', text: error.message })
                  }
                }}>
                  <div className="span-4"><input placeholder="slug" value={workspaceForm.slug} onChange={(e) => setWorkspaceForm((v) => ({ ...v, slug: e.target.value }))} /></div>
                  <div className="span-4"><input placeholder="name" value={workspaceForm.name} onChange={(e) => setWorkspaceForm((v) => ({ ...v, name: e.target.value }))} /></div>
                  <div className="span-4"><input placeholder="default_domain" value={workspaceForm.default_domain} onChange={(e) => setWorkspaceForm((v) => ({ ...v, default_domain: e.target.value }))} /></div>
                  <div className="span-12"><button disabled={!isSuperadmin || saveWorkspaceMutation.isPending}>保存 Workspace</button></div>
                </form>

                <h3 style={{ marginTop: 16 }}>绑定 Domain 到 Workspace（superadmin）</h3>
                <form className="form-row" onSubmit={async (e) => {
                  e.preventDefault()
                  setMessage(null)
                  try {
                    await bindWorkspaceDomainMutation.mutateAsync(workspaceDomainForm)
                    setWorkspaceDomainForm({ slug: '', domain: '' })
                    setMessage({ kind: 'success', text: 'Domain 已绑定到 Workspace' })
                  } catch (error) {
                    setMessage({ kind: 'error', text: error.message })
                  }
                }}>
                  <div className="span-6"><input placeholder="workspace_slug" value={workspaceDomainForm.slug} onChange={(e) => setWorkspaceDomainForm((v) => ({ ...v, slug: e.target.value }))} /></div>
                  <div className="span-6"><input placeholder="domain" value={workspaceDomainForm.domain} onChange={(e) => setWorkspaceDomainForm((v) => ({ ...v, domain: e.target.value }))} /></div>
                  <div className="span-12"><button disabled={!isSuperadmin || bindWorkspaceDomainMutation.isPending}>绑定 Domain</button></div>
                </form>
              </div>

              <div className="col-6 card">
                <div className="toolbar">
                  <h3 style={{ margin: 0 }}>Workspace 列表</h3>
                  <div className="grow" />
                  <button className="secondary small" onClick={() => workspacesQuery.refetch()} disabled={workspacesQuery.isFetching}>刷新</button>
                </div>
                {renderQueryError(workspacesQuery)}
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
                            disabled={!isSuperadmin || toggleWorkspaceStatusMutation.isPending}
                            onClick={async () => {
                              setMessage(null)
                              try {
                                await toggleWorkspaceStatusMutation.mutateAsync({ slug: row.slug, active: !row.active })
                                setMessage({ kind: 'success', text: `Workspace ${row.slug} 状态已更新` })
                              } catch (error) {
                                setMessage({ kind: 'error', text: error.message })
                              }
                            }}
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
                <form className="form-row" onSubmit={async (e) => {
                  e.preventDefault()
                  setMessage(null)
                  try {
                    await saveAdminUserMutation.mutateAsync(adminForm)
                    setAdminForm({ username: '', password: '', role: 'workspace_admin', active: true })
                    setMessage({ kind: 'success', text: '管理员已保存' })
                  } catch (error) {
                    setMessage({ kind: 'error', text: error.message })
                  }
                }}>
                  <div className="span-4"><input placeholder="username" value={adminForm.username} onChange={(e) => setAdminForm((v) => ({ ...v, username: e.target.value }))} /></div>
                  <div className="span-4"><input type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder="password (new only)" value={adminForm.password} onChange={(e) => setAdminForm((v) => ({ ...v, password: e.target.value }))} /></div>
                  <div className="span-2"><select value={adminForm.role} onChange={(e) => setAdminForm((v) => ({ ...v, role: e.target.value }))}><option value="workspace_admin">workspace_admin</option><option value="superadmin">superadmin</option></select></div>
                  <div className="span-2"><select value={adminForm.active ? '1' : '0'} onChange={(e) => setAdminForm((v) => ({ ...v, active: e.target.value === '1' }))}><option value="1">active</option><option value="0">inactive</option></select></div>
                  <div className="span-12"><button disabled={!isSuperadmin || saveAdminUserMutation.isPending}>保存管理员</button></div>
                </form>

                <h3 style={{ marginTop: 16 }}>重置管理员密码（superadmin）</h3>
                <form className="form-row" onSubmit={async (e) => {
                  e.preventDefault()
                  setMessage(null)
                  try {
                    await resetAdminPasswordMutation.mutateAsync({ username: adminPasswordForm.username, newPassword: adminPasswordForm.new_password })
                    setAdminPasswordForm({ username: '', new_password: '' })
                    setMessage({ kind: 'success', text: '管理员密码已更新' })
                  } catch (error) {
                    setMessage({ kind: 'error', text: error.message })
                  }
                }}>
                  <div className="span-6"><input placeholder="username" value={adminPasswordForm.username} onChange={(e) => setAdminPasswordForm((v) => ({ ...v, username: e.target.value }))} /></div>
                  <div className="span-6"><input type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder="new_password" value={adminPasswordForm.new_password} onChange={(e) => setAdminPasswordForm((v) => ({ ...v, new_password: e.target.value }))} /></div>
                  <div className="span-12"><button disabled={!isSuperadmin || resetAdminPasswordMutation.isPending}>更新密码</button></div>
                </form>

                <h3 style={{ marginTop: 16 }}>绑定管理员 Workspace 权限（superadmin）</h3>
                <form className="form-row" onSubmit={async (e) => {
                  e.preventDefault()
                  setMessage(null)
                  try {
                    await saveAdminBindingsMutation.mutateAsync(bindingForm)
                    setBindingLookupUser(bindingForm.username)
                    setMessage({ kind: 'success', text: '管理员 workspace 绑定已更新' })
                  } catch (error) {
                    setMessage({ kind: 'error', text: error.message })
                  }
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
                  <div className="span-12"><button disabled={!isSuperadmin || saveAdminBindingsMutation.isPending}>写入绑定</button></div>
                </form>
              </div>

              <div className="col-6 card">
                <div className="toolbar">
                  <h3 style={{ margin: 0 }}>管理员列表</h3>
                  <div className="grow" />
                  <button className="secondary small" onClick={() => adminUsersQuery.refetch()} disabled={adminUsersQuery.isFetching || !isSuperadmin}>刷新</button>
                </div>
                {renderQueryError(adminUsersQuery)}
                {renderQueryError(bindingsQuery)}
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
                          {(bindingLookupUser === row.username ? (bindingsQuery.data || []) : row.bindings || []).map((b) => (
                            <div key={`${row.username}-${b.workspace_slug}`} className="smalltext">{b.workspace_slug} · R:{String(b.can_read)} W:{String(b.can_write)} D/M/A:{String(b.manage_domains)}/{String(b.manage_mailboxes)}/{String(b.manage_aliases)}</div>
                          ))}
                        </td>
                        <td>
                          <div className="toolbar">
                            <button className="ghost small" disabled={!isSuperadmin || bindingsQuery.isFetching} onClick={() => setBindingLookupUser(row.username)}>查看绑定</button>
                            <button
                              className="ghost small"
                              disabled={!isSuperadmin || toggleAdminStatusMutation.isPending}
                              onClick={async () => {
                                setMessage(null)
                                try {
                                  await toggleAdminStatusMutation.mutateAsync({ username: row.username, active: !row.active })
                                  setMessage({ kind: 'success', text: `管理员 ${row.username} 状态已更新` })
                                } catch (error) {
                                  setMessage({ kind: 'error', text: error.message })
                                }
                              }}
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
                <button className="secondary small" onClick={() => domainsQuery.refetch()} disabled={domainsQuery.isFetching}>刷新</button>
              </div>
              {renderQueryError(domainsQuery)}
              <form className="form-row" onSubmit={async (e) => {
                e.preventDefault()
                setMessage(null)
                try {
                  await saveDomainMutation.mutateAsync(domainForm)
                  setDomainForm({ domain: '', workspace_slug: '' })
                  setMessage({ kind: 'success', text: 'Domain 已保存' })
                } catch (error) {
                  setMessage({ kind: 'error', text: error.message })
                }
              }}>
                <div className="span-6"><input placeholder="domain" value={domainForm.domain} onChange={(e) => setDomainForm((v) => ({ ...v, domain: e.target.value }))} /></div>
                <div className="span-6"><input placeholder="workspace_slug (superadmin only)" value={domainForm.workspace_slug} onChange={(e) => setDomainForm((v) => ({ ...v, workspace_slug: e.target.value }))} /></div>
                <div className="span-12"><button disabled={saveDomainMutation.isPending}>创建 / 激活 Domain</button></div>
              </form>
              <table>
                <thead><tr><th>Domain</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {domains.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td><span className={badgeClass(row.active !== false)}>{row.active === false ? 'inactive' : 'active'}</span></td>
                      <td><button className="ghost small" disabled={toggleDomainStatusMutation.isPending} onClick={async () => {
                        setMessage(null)
                        try {
                          await toggleDomainStatusMutation.mutateAsync({ domain: row.name, active: row.active === false })
                          setMessage({ kind: 'success', text: `Domain ${row.name} 状态已更新` })
                        } catch (error) {
                          setMessage({ kind: 'error', text: error.message })
                        }
                      }}>切换状态</button></td>
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
                <button className="secondary small" onClick={() => mailboxesQuery.refetch()} disabled={mailboxesQuery.isFetching}>刷新</button>
              </div>
              {renderQueryError(mailboxesQuery)}

              <form className="form-row" onSubmit={async (e) => {
                e.preventDefault()
                setMessage(null)
                try {
                  await createMailboxMutation.mutateAsync(mailboxForm)
                  setMailboxForm({ email: '', password: '' })
                  setMessage({ kind: 'success', text: 'Mailbox 已创建' })
                } catch (error) {
                  setMessage({ kind: 'error', text: error.message })
                }
              }}>
                <div className="span-6"><input placeholder="email" value={mailboxForm.email} onChange={(e) => setMailboxForm((v) => ({ ...v, email: e.target.value }))} /></div>
                <div className="span-6"><input type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder="password" value={mailboxForm.password} onChange={(e) => setMailboxForm((v) => ({ ...v, password: e.target.value }))} /></div>
                <div className="span-12"><button disabled={createMailboxMutation.isPending}>创建 Mailbox</button></div>
              </form>

              <form className="form-row" onSubmit={async (e) => {
                e.preventDefault()
                setMessage(null)
                try {
                  await resetMailboxPasswordMutation.mutateAsync({ email: mailboxPasswordForm.email, newPassword: mailboxPasswordForm.new_password })
                  setMailboxPasswordForm({ email: '', new_password: '' })
                  setMessage({ kind: 'success', text: 'Mailbox 密码已更新' })
                } catch (error) {
                  setMessage({ kind: 'error', text: error.message })
                }
              }}>
                <div className="span-6"><input placeholder="email" value={mailboxPasswordForm.email} onChange={(e) => setMailboxPasswordForm((v) => ({ ...v, email: e.target.value }))} /></div>
                <div className="span-6"><input type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder="new_password" value={mailboxPasswordForm.new_password} onChange={(e) => setMailboxPasswordForm((v) => ({ ...v, new_password: e.target.value }))} /></div>
                <div className="span-12"><button className="secondary" disabled={resetMailboxPasswordMutation.isPending}>更新 Mailbox 密码</button></div>
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
                          <button className="ghost small" disabled={toggleMailboxStatusMutation.isPending} onClick={async () => {
                            setMessage(null)
                            try {
                              await toggleMailboxStatusMutation.mutateAsync({ email: row.email, active: row.active === false })
                              setMessage({ kind: 'success', text: `Mailbox ${row.email} 状态已更新` })
                            } catch (error) {
                              setMessage({ kind: 'error', text: error.message })
                            }
                          }}>切换状态</button>
                          <button className="danger small" disabled={deleteMailboxMutation.isPending} onClick={async () => {
                            setMessage(null)
                            try {
                              await deleteMailboxMutation.mutateAsync(row.email)
                              setMessage({ kind: 'success', text: `Mailbox ${row.email} 已删除` })
                            } catch (error) {
                              setMessage({ kind: 'error', text: error.message })
                            }
                          }}>删除</button>
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
                <button className="secondary small" onClick={() => aliasesQuery.refetch()} disabled={aliasesQuery.isFetching}>刷新</button>
              </div>
              {renderQueryError(aliasesQuery)}

              <form className="form-row" onSubmit={async (e) => {
                e.preventDefault()
                setMessage(null)
                try {
                  await saveAliasMutation.mutateAsync(aliasForm)
                  setAliasForm({ source: '', destination: '' })
                  setMessage({ kind: 'success', text: 'Alias 已保存' })
                } catch (error) {
                  setMessage({ kind: 'error', text: error.message })
                }
              }}>
                <div className="span-6"><input placeholder="source" value={aliasForm.source} onChange={(e) => setAliasForm((v) => ({ ...v, source: e.target.value }))} /></div>
                <div className="span-6"><input placeholder="destination" value={aliasForm.destination} onChange={(e) => setAliasForm((v) => ({ ...v, destination: e.target.value }))} /></div>
                <div className="span-12"><button disabled={saveAliasMutation.isPending}>创建 / 更新 Alias</button></div>
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
                          <button className="ghost small" disabled={toggleAliasStatusMutation.isPending} onClick={async () => {
                            setMessage(null)
                            try {
                              await toggleAliasStatusMutation.mutateAsync({ source: row.source, active: row.active === false })
                              setMessage({ kind: 'success', text: `Alias ${row.source} 状态已更新` })
                            } catch (error) {
                              setMessage({ kind: 'error', text: error.message })
                            }
                          }}>切换状态</button>
                          <button className="danger small" disabled={deleteAliasMutation.isPending} onClick={async () => {
                            setMessage(null)
                            try {
                              await deleteAliasMutation.mutateAsync(row.source)
                              setMessage({ kind: 'success', text: `Alias ${row.source} 已删除` })
                            } catch (error) {
                              setMessage({ kind: 'error', text: error.message })
                            }
                          }}>删除</button>
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
