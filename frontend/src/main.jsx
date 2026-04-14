import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function App() {
  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="brand">MailOps Frontend Source</div>
        <div className="muted" style={{ marginTop: 10 }}>
          这个目录是 React/Vite 源码基线，当前可直接上线的静态产物仍在 <code>frontend/dist/</code>。
        </div>
        <div className="list" style={{ marginTop: 18 }}>
          <a className="list-item" href="/admin/">打开管理员后台</a>
          <a className="list-item" href="/portal/">打开邮箱用户中心</a>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
