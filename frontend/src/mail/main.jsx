import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
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

function formatDateLabel(value) {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return value
  return dt.toLocaleString()
}

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

  const selectedMessageId = selectedMessageRef?.message_id
  const selectedMessage = messageQuery.data?.item

  const sanitizedHTML = useMemo(() => {
    const html = String(selectedMessage?.html || '').trim()
    if (!html) return ''
    return DOMPurify.sanitize(html, { FORBID_TAGS: ['img'] })
  }, [selectedMessage?.html])

  useEffect(() => {
    if (authError) handleSessionExpired()
  }, [authError])

  if (authError) return null

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
          <button className="small compose-button" onClick={() => setComposeOpen(true)}>Compose</button>
          <button className={`mailbox-link ${activeAccountId === 'all' ? 'active' : ''}`} onClick={() => setActiveAccountId('all')}>All Inboxes</button>
          {accounts.map((account) => (
            <div key={account.account_id} className="mailbox-row">
              <button
                className={`mailbox-link ${activeAccountId === account.account_id ? 'active' : ''}`}
                onClick={() => setActiveAccountId(account.account_id)}
                title={account.email}
              >
                <span className="line-clamp-1">{account.email}</span>
              </button>
              <button className="ghost small" onClick={() => disconnectMutation.mutate(account.account_id)}>×</button>
            </div>
          ))}
          <button className="ghost small add-mailbox-button" onClick={() => setAddOpen((v) => !v)}>+ Add mailbox</button>
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
          <div className="mail-list" role="list">
            {inboxQuery.isPending ? <div className="mail-state">Loading inbox…</div> : null}
            {inboxQuery.isError ? <div className="mail-state error">Failed to load inbox.</div> : null}
            {!inboxQuery.isPending && !inboxQuery.isError && !inboxItems.length ? <div className="mail-state muted">No messages</div> : null}
            {!inboxQuery.isPending && !inboxQuery.isError ? inboxItems.map((item) => (
              <button
                key={item.message_id}
                className={`mail-row ${selectedMessageId === item.message_id ? 'active' : ''}`}
                onClick={() => setSelectedMessageRef(item)}
                role="listitem"
              >
                <div className="mail-row-line">
                  <span className="badge mail-account-badge line-clamp-1">{item.account_email}</span>
                  <b className="mail-from line-clamp-1">{item.from || '(unknown)'}</b>
                  <span className="grow" />
                  <span className="mail-date line-clamp-1">{formatDateLabel(item.internal_date || item.date || '')}</span>
                </div>
                <div className="mail-row-subject line-clamp-1">{item.subject || '(No subject)'}</div>
                <div className="mail-item-preview line-clamp-2">{item.preview || ''}</div>
              </button>
            )) : null}
          </div>
        </section>

        <section className="reader-column">
          {!selectedMessageRef ? <div className="mail-state muted">Select a message.</div> : null}
          {selectedMessageRef && messageQuery.isPending ? <div className="mail-state">Loading message…</div> : null}
          {selectedMessageRef && messageQuery.isError ? <div className="mail-state error">Failed to load message.</div> : null}
          {selectedMessage ? (
            <article className="card webmail-pane webmail-reader">
              <header className="reader-header">
                <h2 className="reader-subject">{selectedMessage.subject || '(No subject)'}</h2>
                <div className="reader-meta"><span>From:</span><span>{selectedMessage.from || ''}</span></div>
                <div className="reader-meta"><span>To:</span><span>{selectedMessage.to || ''}</span></div>
                <div className="reader-meta"><span>Date:</span><span>{formatDateLabel(selectedMessage.date || '')}</span></div>
                <div className="reader-meta"><span>Account:</span><span>{selectedMessage.account_email || ''}</span></div>
              </header>
              {(selectedMessage.attachments || []).length ? (
                <section className="attachment-bar" aria-label="attachments">
                  {(selectedMessage.attachments || []).map((att, index) => (
                    <div key={`${att.filename || 'file'}-${index}`} className="attachment-chip">
                      <span className="line-clamp-1">{att.filename || '(unnamed file)'}</span>
                      <small>{att.content_type || 'application/octet-stream'}</small>
                      <small>{Number(att.size || 0).toLocaleString()} B</small>
                    </div>
                  ))}
                </section>
              ) : null}
              <section className="reader-body">
                {String(selectedMessage.text || '').trim()
                  ? <div className="mail-body mail-text-body">{selectedMessage.text}</div>
                  : sanitizedHTML
                    ? <div className="mail-body" dangerouslySetInnerHTML={{ __html: sanitizedHTML }} />
                    : <div className="mail-state muted">Message body is empty.</div>}
              </section>
            </article>
          ) : null}
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
