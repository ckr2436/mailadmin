import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MailSidebar } from '../components/mail/Sidebar'
import { InboxList } from '../components/mail/InboxList'
import { MessageViewer } from '../components/mail/MessageViewer'
import { ComposePanel } from '../components/mail/ComposePanel'
import { logoutPortal } from '../shared/auth'
import { handleSessionExpired, getAliases, getInbox, getMessage, getPortalSession, getProfile, sendMessage, updatePassword } from '../shared/webmail'
import '../styles.css'

function MailApp() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState({})
  const [aliases, setAliases] = useState([])
  const [inboxItems, setInboxItems] = useState([])
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [topMessage, setTopMessage] = useState(null)
  const [composeFeedback, setComposeFeedback] = useState(null)
  const [passwordMessage, setPasswordMessage] = useState(null)
  const [composeBusy, setComposeBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)

  const withSessionGuard = async (action) => {
    try {
      await action()
    } catch (error) {
      if (error.status === 401) {
        setTopMessage({ kind: 'error', text: 'Session expired. Please sign in again.' })
        setTimeout(handleSessionExpired, 700)
        return
      }
      setTopMessage({ kind: 'error', text: error.message })
    }
  }

  const refreshInbox = () => withSessionGuard(async () => {
    const data = await getInbox(20)
    setInboxItems(data.items || [])
  })

  const loadMessage = (uid) => withSessionGuard(async () => {
    const data = await getMessage(uid)
    setSelectedMessage(data.item || null)
  })

  useEffect(() => {
    withSessionGuard(async () => {
      const [sessionData, profileData, aliasData] = await Promise.all([
        getPortalSession(),
        getProfile(),
        getAliases(),
      ])
      setSession(sessionData)
      setProfile(profileData.profile || {})
      setAliases(aliasData.items || [])
      const inboxData = await getInbox(20)
      setInboxItems(inboxData.items || [])
    })
  }, [])

  const onSend = async (event) => {
    event.preventDefault()
    setComposeFeedback(null)
    const form = new FormData(event.currentTarget)
    const payload = {
      to: String(form.get('to') || '').trim(),
      subject: String(form.get('subject') || '').trim(),
      body: String(form.get('body') || ''),
    }

    setComposeBusy(true)
    await withSessionGuard(async () => {
      await sendMessage(payload)
      setComposeFeedback({ kind: 'success', text: 'Message sent.' })
      event.currentTarget.reset()
      await refreshInbox()
    })
    setComposeBusy(false)
  }

  const onPasswordUpdate = async (event) => {
    event.preventDefault()
    setPasswordMessage(null)
    const form = new FormData(event.currentTarget)
    const payload = {
      current_password: String(form.get('current_password') || ''),
      new_password: String(form.get('new_password') || ''),
    }

    setPasswordBusy(true)
    try {
      await updatePassword(payload)
      setPasswordMessage({ kind: 'success', text: 'Password updated. Please sign in again.' })
      setTimeout(async () => {
        await logoutPortal()
        window.location.href = '/'
      }, 500)
    } catch (error) {
      setPasswordMessage({ kind: 'error', text: error.message })
    } finally {
      setPasswordBusy(false)
    }
  }

  const onLogout = async () => {
    await logoutPortal()
    window.location.href = '/'
  }

  return (
    <div className="wrap">
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="brand">Webmail</div>
        <span className="badge">{session ? `${session.email || session.subject || ''} · ${session.workspace_slug || ''}` : 'Loading...'}</span>
        <div className="grow" />
        <button className="secondary small" onClick={refreshInbox}>Refresh</button>
        <button className="ghost small" onClick={onLogout}>Sign out</button>
      </div>

      {topMessage?.text ? <div className={topMessage.kind} style={{ marginBottom: 12 }}>{topMessage.text}</div> : null}

      <div className="mail-layout">
        <MailSidebar
          profile={profile}
          aliases={aliases}
          onPasswordUpdate={onPasswordUpdate}
          passwordBusy={passwordBusy}
          passwordMessage={passwordMessage}
        />

        <main className="mail-main">
          <InboxList items={inboxItems} onSelect={loadMessage} />
          <MessageViewer message={selectedMessage} />
          <ComposePanel onSend={onSend} busy={composeBusy} feedback={composeFeedback} />
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<MailApp />)
