import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LoginForm } from '../components/login/LoginForm'
import { loginAndConnect } from '../shared/auth'
import '../styles.css'

const DEFAULT_LOGIN_DOMAIN = 'myupona.com'

function normalizeMailboxLogin(username) {
  const value = String(username || '').trim().toLowerCase()
  if (!value) return ''
  return value.includes('@') ? value : `${value}@${DEFAULT_LOGIN_DOMAIN}`
}

function LoginApp() {
  const [busy, setBusy] = useState(false)

  const handleSubmit = async ({ username, password }) => {
    setBusy(true)
    try {
      await loginAndConnect({ email: normalizeMailboxLogin(username), password })
      window.location.href = '/mail/'
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="brand">MYUPONA 邮箱</div>
        <div className="muted" style={{ margin: '10px 0 18px' }}>默认域名：@myupona.com</div>
        <h2 style={{ marginBottom: 10 }}>登录邮箱</h2>
        <div className="smalltext" style={{ marginBottom: 14 }}>只输入用户名和密码即可登录。</div>
        <LoginForm onSubmit={handleSubmit} busy={busy} />
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <a className="smalltext" href="/admin/">管理员后台</a>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<LoginApp />)
