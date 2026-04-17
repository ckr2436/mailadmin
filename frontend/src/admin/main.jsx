import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { apiRequest } from '../shared/api'
import '../styles.css'

function AdminApp() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [session, setSession] = useState(null)
  const [summary, setSummary] = useState(null)
  const [message, setMessage] = useState(null)

  const loadSummary = async () => {
    const [workspaces, domains, mailboxes, aliases] = await Promise.all([
      apiRequest('/api/v1/platform/workspaces', { csrfCookieName: 'mailadmin_csrf_admin' }),
      apiRequest('/api/v1/platform/mail/domains', { csrfCookieName: 'mailadmin_csrf_admin' }),
      apiRequest('/api/v1/platform/mail/mailboxes', { csrfCookieName: 'mailadmin_csrf_admin' }),
      apiRequest('/api/v1/platform/mail/aliases', { csrfCookieName: 'mailadmin_csrf_admin' }),
    ])

    setSummary({
      workspaces: (workspaces.items || []).length,
      domains: (domains.items || []).length,
      mailboxes: (mailboxes.items || []).length,
      aliases: (aliases.items || []).length,
    })
  }

  const onLogin = async (event) => {
    event.preventDefault()
    setMessage(null)
    try {
      await apiRequest('/api/v1/platform/auth/login', {
        method: 'POST',
        body: { username, password },
        csrfCookieName: 'mailadmin_csrf_admin',
      })
      const sessionData = await apiRequest('/api/v1/platform/auth/session', {
        csrfCookieName: 'mailadmin_csrf_admin',
      })
      setSession(sessionData)
      await loadSummary()
      setPassword('')
    } catch (error) {
      setMessage({ kind: 'error', text: error.message })
    }
  }

  const onLogout = async () => {
    await apiRequest('/api/v1/platform/auth/logout', {
      method: 'POST',
      csrfCookieName: 'mailadmin_csrf_admin',
    }).catch(() => {})
    setSession(null)
    setSummary(null)
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
          {session ? <button className="ghost small" onClick={onLogout}>退出</button> : null}
        </div>
      </div>

      {!session ? (
        <div className="card">
          <h2>管理员登录</h2>
          <form className="form-row" onSubmit={onLogin}>
            <div className="span-4"><input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div className="span-4"><input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <div className="span-4"><button>登录</button></div>
          </form>
          <div className="smalltext">支持 superadmin / workspace_admin。登录后按权限加载统计视图。</div>
          {message?.text ? <div className={message.kind}>{message.text}</div> : null}
        </div>
      ) : (
        <div className="card">
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>Dashboard</h2>
            <div className="grow" />
            <button className="secondary small" onClick={loadSummary}>刷新数据</button>
          </div>
          <div className="kpis" style={{ marginTop: 12 }}>
            <div className="kpi"><div className="muted">Workspaces</div><div className="n">{summary?.workspaces ?? '-'}</div></div>
            <div className="kpi"><div className="muted">Domains</div><div className="n">{summary?.domains ?? '-'}</div></div>
            <div className="kpi"><div className="muted">Mailboxes</div><div className="n">{summary?.mailboxes ?? '-'}</div></div>
            <div className="kpi"><div className="muted">Aliases</div><div className="n">{summary?.aliases ?? '-'}</div></div>
          </div>
          <hr />
          <div className="smalltext">专业化改造已完成多入口与统一源码化；此处作为后台入口骨架，后续可继续扩展完整管理面板。</div>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<AdminApp />)
