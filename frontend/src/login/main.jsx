import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LoginForm } from '../components/login/LoginForm'
import { loginAndConnect } from '../shared/auth'
import '../styles.css'

function LoginApp() {
  const [busy, setBusy] = useState(false)

  const handleSubmit = async ({ email, password }) => {
    setBusy(true)
    try {
      await loginAndConnect({ email, password })
      window.location.href = '/mail/'
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="brand">MYUPONA 邮箱</div>
        <div className="muted" style={{ margin: '10px 0 18px' }}>myupona.com 域名邮箱</div>
        <h2 style={{ marginBottom: 10 }}>登录邮箱</h2>
        <div className="smalltext" style={{ marginBottom: 14 }}>请输入邮箱地址和密码，进入网页版邮箱。</div>
        <LoginForm onSubmit={handleSubmit} busy={busy} />
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <a className="smalltext" href="/admin/">管理员后台</a>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<LoginApp />)
