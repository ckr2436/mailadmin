import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function App() {
  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="brand">myupona Mail</div>
        <div className="muted" style={{ marginTop: 10 }}>This source baseline now mirrors production routing.</div>
        <div className="list" style={{ marginTop: 18 }}>
          <a className="list-item" href="/">Mailbox Sign in</a>
          <a className="list-item" href="/mail/">Webmail Dashboard</a>
          <a className="list-item" href="/admin/">Admin Console</a>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
