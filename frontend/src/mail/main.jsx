import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logoutPortal } from '../shared/auth'
import {
  connectMailbox,
  disconnectMailbox,
  getInbox,
  getMailAccounts,
  getMailSession,
  getMessage,
  handleSessionExpired,
  logoutMailSession,
  sendMessage,
} from '../shared/webmail'
import '../styles.css'

const queryClient = new QueryClient()

function MailApp() {
  const qc = useQueryClient()
  const [activeAccountId, setActiveAccountId] = useState('all')
  const [selectedMessageRef, setSelectedMessageRef] = useState(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const sessionQuery = useQuery({ queryKey: ['mailSession'], queryFn: getMailSession, retry: false })
  const accountsQuery = useQuery({ queryKey: ['mailAccounts'], queryFn: getMailAccounts, retry: false })
  const inboxQuery = useQuery({
    queryKey: ['mailInbox', activeAccountId],
    queryFn: () => getInbox(activeAccountId, 50),
    enabled: !!sessionQuery.data,
  })

  const messageQuery = useQuery({
    queryKey: ['mailMessage', selectedMessageRef?.account_id, selectedMessageRef?.folder, selectedMessageRef?.uid],
    queryFn: () => getMessage(selectedMessageRef.account_id, selectedMessageRef.uid, selectedMessageRef.folder || 'INBOX'),
    enabled: !!selectedMessageRef?.account_id && !!selectedMessageRef?.uid,
  })

  const connectMutation = useMutation({
    mutationFn: connectMailbox,
    onSuccess: () => {
      setAddOpen(false)
      qc.invalidateQueries({ queryKey: ['mailAccounts'] })
      qc.invalidateQueries({ queryKey: ['mailInbox'] })
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: disconnectMailbox,
    onSuccess: () => {
      setSelectedMessageRef(null)
      setActiveAccountId('all')
      qc.invalidateQueries({ queryKey: ['mailAccounts'] })
      qc.invalidateQueries({ queryKey: ['mailInbox'] })
    },
  })

  const sendMutation = useMutation({
    mutationFn: sendMessage,
    onSuccess: () => {
      setComposeOpen(false)
      qc.invalidateQueries({ queryKey: ['mailInbox'] })
    },
  })

  const authError = sessionQuery.error?.status === 401 || accountsQuery.error?.status === 401
  const accounts = accountsQuery.data?.accounts || accountsQuery.data?.items || []
  const inboxItems = inboxQuery.data?.items || []
  const defaultFrom = accounts.length
    ? activeAccountId === 'all' ? accounts[0].account_id : activeAccountId
    : ''

  useEffect(() => {
    if (authError) handleSessionExpired()
  }, [authError])

  if (authError) {
    return null
  }

  return (
    <div className="webmail-app">
      <header className="webmail-topbar">
        <div className="brand">myupona Mail</div>
        <span className="badge">{sessionQuery.data?.session?.primary_email || '...'}</span>
        <div className="grow" />
        <button className="secondary small" onClick={() => qc.invalidateQueries({ queryKey: ['mailInbox'] })}>Refresh</button>
        <button className="ghost small" onClick={async () => { await logoutMailSession(); await logoutPortal(); window.location.href = '/' }}>Sign out</button>
      </header>

      <div className="webmail-shell">
        <aside className="webmail-sidebar">
          <button className="small" onClick={() => setComposeOpen(true)} style={{ width: '100%', marginBottom: 8 }}>Compose</button>
          <button className={`mailbox-link ${activeAccountId === 'all' ? 'active' : ''}`} onClick={() => setActiveAccountId('all')}>All Inboxes</button>
          {accounts.map((account) => (
            <div key={account.account_id} className="mailbox-row">
              <button className={`mailbox-link ${activeAccountId === account.account_id ? 'active' : ''}`} onClick={() => setActiveAccountId(account.account_id)}>{account.email}</button>
              <button className="ghost small" onClick={() => disconnectMutation.mutate(account.account_id)}>×</button>
            </div>
          ))}
          <button className="ghost small" onClick={() => setAddOpen((v) => !v)} style={{ marginTop: 10 }}>+ Add mailbox</button>
          {addOpen ? (
            <form className="form-row" onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              connectMutation.mutate({ email: String(fd.get('email') || ''), password: String(fd.get('password') || '') })
            }}>
              <input name="email" placeholder="support@domain.com" />
              <input name="password" type="password" placeholder="Password" />
              <button disabled={connectMutation.isPending}>{connectMutation.isPending ? 'Connecting...' : 'Connect'}</button>
            </form>
          ) : null}
        </aside>

        <section className="inbox-column">
          <div className="mail-list">
            {inboxItems.map((item) => (
              <button key={item.message_id} className="mail-row" onClick={() => setSelectedMessageRef(item)}>
                <div className="mail-row-line"><span className="badge">{item.account_email}</span><b>{item.from || '(unknown)'}</b><span className="grow" />{item.internal_date || item.date || ''}</div>
                <div className="mail-row-subject">{item.subject || '(No subject)'}</div>
                <div className="mail-item-preview">{item.preview || ''}</div>
              </button>
            ))}
            {!inboxItems.length ? <div className="muted" style={{ padding: 12 }}>No messages</div> : null}
          </div>
        </section>

        <section className="reader-column">
          {messageQuery.data?.item ? (
            <div className="card webmail-pane">
              <h3>{messageQuery.data.item.subject || '(No subject)'}</h3>
              <div className="smalltext">From: {messageQuery.data.item.from || ''}</div>
              <div className="smalltext">To: {messageQuery.data.item.to || ''}</div>
              <div className="smalltext">Date: {messageQuery.data.item.date || ''}</div>
              <div className="smalltext">Account: {messageQuery.data.item.account_email || ''}</div>
              <hr />
              <pre className="mail-body">{messageQuery.data.item.text || ''}</pre>
            </div>
          ) : <div className="muted" style={{ padding: 12 }}>Select a message.</div>}
        </section>
      </div>

      {composeOpen ? (
        <div className="card compose-drawer">
          <div className="toolbar"><b>Compose</b><div className="grow" /><button className="ghost small" onClick={() => setComposeOpen(false)}>Close</button></div>
          <form className="form-row" onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            sendMutation.mutate({
              account_id: String(fd.get('account_id') || defaultFrom),
              to: String(fd.get('to') || ''),
              subject: String(fd.get('subject') || ''),
              body: String(fd.get('body') || ''),
            })
          }}>
            <select name="account_id" defaultValue={defaultFrom}>{accounts.map((account) => <option key={account.account_id} value={account.account_id}>{account.email}</option>)}</select>
            <input name="to" placeholder="To" />
            <input name="subject" placeholder="Subject" />
            <textarea name="body" rows={7} placeholder="Message body" />
            <button disabled={sendMutation.isPending}>{sendMutation.isPending ? 'Sending...' : 'Send'}</button>
          </form>
        </div>
      ) : null}
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <MailApp />
  </QueryClientProvider>,
)
