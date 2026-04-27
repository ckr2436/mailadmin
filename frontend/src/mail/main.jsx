import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
import { logoutPortal } from '../shared/auth'
import {
  connectMailbox,
  deleteMessage,
  disconnectMailbox,
  getFolderMessages,
  getFolders,
  getInbox,
  getMailAccounts,
  getMailSession,
  getMessage,
  handleSessionExpired,
  logoutMailSession,
  markJunk,
  moveMessage,
  saveDraft,
  sendMessage,
} from '../shared/webmail'
import { visibleFolders } from './folderConfig'
import { getSendNoticeOnError, getSendNoticeOnMutate, getSendNoticeOnSuccess } from './sendNoticeState'
import '../styles.css'

const queryClient = new QueryClient()
const MAX_LINK_LENGTH = 8192
const SAFE_HTML_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SAFE_TEXT_LINK_PROTOCOLS = new Set(['http:', 'https:'])

function formatDateLabel(value) {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return value
  return dt.toLocaleString('zh-CN')
}

function normalizeProtocol(href) {
  const match = String(href || '').trim().match(/^([a-z][a-z0-9+.-]*):/i)
  return match ? `${match[1].toLowerCase()}:` : ''
}

function safeMailHref(rawHref, allowedProtocols = SAFE_HTML_LINK_PROTOCOLS) {
  const href = String(rawHref || '').trim()
  if (!href || href.length > MAX_LINK_LENGTH) return ''

  const protocol = normalizeProtocol(href)
  if (!protocol || !allowedProtocols.has(protocol)) return ''

  try {
    const parsed = new URL(href)
    return allowedProtocols.has(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}

function sanitizeMailHTML(rawHTML) {
  const html = String(rawHTML || '').trim()
  if (!html) return ''

  const sanitized = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['img', 'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['src', 'srcset'],
  })

  const template = document.createElement('template')
  template.innerHTML = sanitized

  template.content.querySelectorAll('a[href]').forEach((anchor) => {
    const href = safeMailHref(anchor.getAttribute('href') || '')
    if (!href) {
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
      anchor.removeAttribute('rel')
      return
    }
    anchor.setAttribute('href', href)
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer nofollow')
  })

  return template.innerHTML.trim()
}

function cleanPlainTextURL(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/^<+|>+$/g, '')
    .trim()
}

function stripTrailingURLPunctuation(value) {
  let href = value
  let suffix = ''
  while (/[.,;:!?，。；：！？]$/.test(href)) {
    suffix = href[href.length - 1] + suffix
    href = href.slice(0, -1)
  }
  return { href, suffix }
}

function linkFallbackLabel(href) {
  try {
    const parsed = new URL(href)
    return parsed.hostname ? `打开 ${parsed.hostname}` : '打开链接'
  } catch {
    return '打开链接'
  }
}

function isReadableLinkLabel(value) {
  const label = String(value || '').trim()
  if (label.length < 2 || label.length > 120) return false
  if (/https?:\/\//i.test(label)) return false
  if (/^[\s:：>\-–—|/\\()[\]{}.,;!?，。；！？]+$/.test(label)) return false
  return /[\p{L}\p{N}\u4e00-\u9fff]/u.test(label)
}

function normalizeLinkLabel(value, href) {
  const label = String(value || '')
    .replace(/[\t ]+/g, ' ')
    .replace(/[：:：\-–—|>\s]+$/g, '')
    .trim()
  return isReadableLinkLabel(label) ? label : linkFallbackLabel(href)
}

function createMailLink(href, label, key) {
  return (
    <a
      key={key}
      className="plain-mail-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={href}
    >
      {label}
    </a>
  )
}

function appendTextWithBareLinks(nodes, text, keyRef) {
  if (!text) return

  const bareURLPattern = /https?:\/\/[^\s<>()]+/gi
  let cursor = 0
  let match

  while ((match = bareURLPattern.exec(text)) !== null) {
    const rawCandidate = match[0]
    const { href: strippedCandidate, suffix } = stripTrailingURLPunctuation(rawCandidate)
    const href = safeMailHref(cleanPlainTextURL(strippedCandidate), SAFE_TEXT_LINK_PROTOCOLS)

    if (!href) continue

    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index))
    }
    nodes.push(createMailLink(href, linkFallbackLabel(href), `bare-link-${keyRef.current++}`))
    if (suffix) nodes.push(suffix)
    cursor = match.index + rawCandidate.length
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }
}

function buildPlainMailNodes(rawText) {
  const text = String(rawText || '').replace(/\r\n?/g, '\n')
  if (!text) return null

  const nodes = []
  const keyRef = { current: 0 }
  const parenthesizedURLPattern = /\(\s*(https?:\/\/[\s\S]*?)\s*\)/gi
  let cursor = 0
  let match

  while ((match = parenthesizedURLPattern.exec(text)) !== null) {
    const href = safeMailHref(cleanPlainTextURL(match[1]), SAFE_TEXT_LINK_PROTOCOLS)
    if (!href) continue

    const prefix = text.slice(cursor, match.index)
    const labelStart = prefix.lastIndexOf('\n') + 1
    const beforeLabel = prefix.slice(0, labelStart)
    const labelCandidate = prefix.slice(labelStart)

    if (isReadableLinkLabel(labelCandidate)) {
      appendTextWithBareLinks(nodes, beforeLabel, keyRef)
      nodes.push(createMailLink(href, normalizeLinkLabel(labelCandidate, href), `labeled-link-${keyRef.current++}`))
    } else {
      appendTextWithBareLinks(nodes, prefix, keyRef)
      nodes.push(createMailLink(href, linkFallbackLabel(href), `parenthesized-link-${keyRef.current++}`))
    }

    cursor = match.index + match[0].length
  }

  appendTextWithBareLinks(nodes, text.slice(cursor), keyRef)
  return nodes
}

function MailApp() {
  const qc = useQueryClient()
  const [activeAccountId, setActiveAccountId] = useState('all')
  const [activeFolder, setActiveFolder] = useState('INBOX')
  const [selectedMessageRef, setSelectedMessageRef] = useState(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const sessionQuery = useQuery({ queryKey: ['mailSession'], queryFn: getMailSession, retry: false })
  const accountsQuery = useQuery({ queryKey: ['mailAccounts'], queryFn: getMailAccounts, retry: false })
  const accountFoldersQuery = useQuery({
    queryKey: ['mailFolders', activeAccountId],
    queryFn: () => getFolders(activeAccountId),
    enabled: !!sessionQuery.data && activeAccountId !== 'all',
  })
  const inboxQuery = useQuery({
    queryKey: ['mailInbox', activeAccountId, activeFolder],
    queryFn: () => (activeAccountId === 'all'
      ? getInbox(activeAccountId, 50)
      : getFolderMessages(activeAccountId, activeFolder, 50)),
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
    onMutate: () => {
      setNotice(getSendNoticeOnMutate())
    },
    onSuccess: (res) => {
      setComposeOpen(false)
      setNotice(getSendNoticeOnSuccess(res))
      qc.invalidateQueries({ queryKey: ['mailInbox'] })
    },
    onError: () => {
      setNotice(getSendNoticeOnError())
    },
  })
  const draftMutation = useMutation({
    mutationFn: ({ accountId, payload }) => saveDraft(accountId, payload),
    onSuccess: () => {
      if (activeFolder === 'Drafts') {
        qc.invalidateQueries({ queryKey: ['mailInbox'] })
      }
    },
  })
  const deleteMutation = useMutation({
    mutationFn: ({ accountId, folder, uid }) => deleteMessage(accountId, folder, uid),
    onSuccess: () => {
      setSelectedMessageRef(null)
      qc.invalidateQueries({ queryKey: ['mailInbox'] })
    },
  })
  const moveMutation = useMutation({
    mutationFn: ({ accountId, folder, uid, target }) => moveMessage(accountId, folder, uid, target),
    onSuccess: () => {
      setSelectedMessageRef(null)
      qc.invalidateQueries({ queryKey: ['mailInbox'] })
    },
  })
  const junkMutation = useMutation({
    mutationFn: ({ accountId, folder, uid }) => markJunk(accountId, folder, uid),
    onSuccess: () => {
      setSelectedMessageRef(null)
      qc.invalidateQueries({ queryKey: ['mailInbox'] })
    },
  })

  const authError = sessionQuery.error?.status === 401 || accountsQuery.error?.status === 401
  const accounts = accountsQuery.data?.accounts || accountsQuery.data?.items || []
  const inboxItems = inboxQuery.data?.items || []
  const folderItems = accountFoldersQuery.data?.items || []
  const defaultFrom = accounts.length
    ? activeAccountId === 'all' ? accounts[0].account_id : activeAccountId
    : ''

  const selectedMessageId = selectedMessageRef?.message_id
  const selectedMessage = messageQuery.data?.item

  const sanitizedHTML = useMemo(() => sanitizeMailHTML(selectedMessage?.html || ''), [selectedMessage?.html])
  const plainTextNodes = useMemo(() => buildPlainMailNodes(selectedMessage?.text || ''), [selectedMessage?.text])

  useEffect(() => {
    if (authError) handleSessionExpired()
  }, [authError])

  if (authError) return null

  return (
    <div className="webmail-app">
      <header className="webmail-topbar">
        <div className="brand">MYUPONA 邮箱</div>
        <span className="badge">{sessionQuery.data?.session?.primary_email || '...'}</span>
        <div className="grow" />
        <button className="secondary small" onClick={() => qc.invalidateQueries({ queryKey: ['mailInbox'] })}>刷新</button>
        <button className="ghost small" onClick={async () => { await logoutMailSession(); await logoutPortal(); window.location.href = '/' }}>退出</button>
      </header>

      {notice ? <div className="mail-state warning webmail-notice">{notice}</div> : null}

      <div className="webmail-shell">
        <aside className="webmail-sidebar">
          <button className="small compose-button" onClick={() => setComposeOpen(true)}>写信</button>
          <button className={`mailbox-link ${activeAccountId === 'all' ? 'active' : ''}`} onClick={() => { setActiveAccountId('all'); setActiveFolder('INBOX'); setSelectedMessageRef(null) }}>全部收件箱</button>
          {accounts.map((account) => (
            <div key={account.account_id} className="mailbox-row">
              <button
                className={`mailbox-link ${activeAccountId === account.account_id && activeFolder === 'INBOX' ? 'active' : ''}`}
                onClick={() => { setActiveAccountId(account.account_id); setActiveFolder('INBOX'); setSelectedMessageRef(null) }}
                title={account.email}
              >
                <span className="line-clamp-1">{account.email}</span>
              </button>
              <button className="ghost small" aria-label="移除邮箱" onClick={() => disconnectMutation.mutate(account.account_id)}>×</button>
            </div>
          ))}
          {activeAccountId !== 'all' ? (
            <div className="form-row">
              {visibleFolders(folderItems).map((folder) => (
                  <button key={folder.path} type="button" className={`mailbox-link ${activeFolder === folder.path ? 'active' : ''}`} onClick={() => { setActiveFolder(folder.path); setSelectedMessageRef(null) }}>
                    {folder.name || folder.path}
                  </button>
                ))}
            </div>
          ) : null}
          <button className="ghost small add-mailbox-button" onClick={() => setAddOpen((v) => !v)}>+ 添加邮箱</button>
          {addOpen ? (
            <form className="form-row" onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              connectMutation.mutate({ email: String(fd.get('email') || ''), password: String(fd.get('password') || '') })
            }}>
              <input name="email" placeholder="邮箱地址" />
              <input name="password" type="password" placeholder="邮箱密码" />
              <button disabled={connectMutation.isPending}>{connectMutation.isPending ? '连接中...' : '连接邮箱'}</button>
            </form>
          ) : null}
        </aside>

        <section className="inbox-column">
          <div className="mail-list" role="list">
            {inboxQuery.isPending ? <div className="mail-state">正在加载邮件...</div> : null}
            {inboxQuery.isError ? <div className="mail-state error">邮件加载失败。</div> : null}
            {!inboxQuery.isPending && !inboxQuery.isError && !inboxItems.length ? <div className="mail-state muted">暂无邮件</div> : null}
            {!inboxQuery.isPending && !inboxQuery.isError ? inboxItems.map((item) => (
              <button
                key={item.message_id}
                className={`mail-row ${selectedMessageId === item.message_id ? 'active' : ''}`}
                onClick={() => setSelectedMessageRef(item)}
                role="listitem"
              >
                <div className="mail-row-line">
                  <span className="badge mail-account-badge line-clamp-1">{item.account_email}</span>
                  <b className="mail-from line-clamp-1">{item.from || '未知发件人'}</b>
                  <span className="grow" />
                  <span className="mail-date line-clamp-1">{formatDateLabel(item.internal_date || item.date || '')}</span>
                </div>
                <div className="mail-row-subject line-clamp-1">{item.subject || '无主题'}</div>
                <div className="mail-item-preview line-clamp-2">{item.preview || ''}</div>
              </button>
            )) : null}
          </div>
        </section>

        <section className="reader-column">
          {!selectedMessageRef ? <div className="mail-state muted">请选择一封邮件。</div> : null}
          {selectedMessageRef && messageQuery.isPending ? <div className="mail-state">正在加载邮件内容...</div> : null}
          {selectedMessageRef && messageQuery.isError ? <div className="mail-state error">邮件内容加载失败。</div> : null}
          {selectedMessage ? (
            <article className="card webmail-pane webmail-reader">
              <header className="reader-header">
                <h2 className="reader-subject">{selectedMessage.subject || '无主题'}</h2>
                <div className="toolbar">
                  {(() => {
                    const folder = selectedMessageRef?.folder || activeFolder
                    const accountId = selectedMessageRef?.account_id
                    const uid = selectedMessageRef?.uid
                    if (!accountId || !uid) return null

                    if (folder === 'INBOX') {
                      return (
                        <>
                          <button className="secondary small" disabled={moveMutation.isPending} onClick={() => moveMutation.mutate({ accountId, folder, uid, target: 'Archive' })}>
                            归档
                          </button>
                          <button className="secondary small" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate({ accountId, folder, uid })}>
                            删除
                          </button>
                          <button className="secondary small" disabled={junkMutation.isPending} onClick={() => junkMutation.mutate({ accountId, folder, uid })}>
                            标记为垃圾邮件
                          </button>
                        </>
                      )
                    }
                    if (folder === 'Archive' || folder === 'Junk') {
                      return (
                        <>
                          <button className="secondary small" disabled={moveMutation.isPending} onClick={() => moveMutation.mutate({ accountId, folder, uid, target: 'INBOX' })}>
                            移回收件箱
                          </button>
                          <button className="secondary small" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate({ accountId, folder, uid })}>
                            删除
                          </button>
                        </>
                      )
                    }
                    if (folder === 'Trash') {
                      return (
                        <>
                          <button className="secondary small" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate({ accountId, folder, uid })}>
                            永久删除
                          </button>
                          <button className="secondary small" disabled={moveMutation.isPending} onClick={() => moveMutation.mutate({ accountId, folder, uid, target: 'INBOX' })}>
                            移回收件箱
                          </button>
                        </>
                      )
                    }
                    return (
                      <button className="secondary small" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate({ accountId, folder, uid })}>
                        删除
                      </button>
                    )
                  })()}
                </div>
                <div className="reader-meta"><span>发件人：</span><span>{selectedMessage.from || ''}</span></div>
                <div className="reader-meta"><span>收件人：</span><span>{selectedMessage.to || ''}</span></div>
                <div className="reader-meta"><span>时间：</span><span>{formatDateLabel(selectedMessage.date || '')}</span></div>
                <div className="reader-meta"><span>邮箱：</span><span>{selectedMessage.account_email || ''}</span></div>
              </header>
              {(selectedMessage.attachments || []).length ? (
                <section className="attachment-bar" aria-label="附件">
                  {(selectedMessage.attachments || []).map((att, index) => (
                    <div key={`${att.filename || 'file'}-${index}`} className="attachment-chip">
                      <span className="line-clamp-1">{att.filename || '未命名文件'}</span>
                      <small>{att.content_type || 'application/octet-stream'}</small>
                      <small>{Number(att.size || 0).toLocaleString()} B</small>
                    </div>
                  ))}
                </section>
              ) : null}
              <section className="reader-body">
                {sanitizedHTML
                  ? <div className="mail-body mail-html-body" dangerouslySetInnerHTML={{ __html: sanitizedHTML }} />
                  : String(selectedMessage.text || '').trim()
                    ? <div className="mail-body mail-text-body">{plainTextNodes}</div>
                    : <div className="mail-state muted">邮件正文为空。</div>}
              </section>
            </article>
          ) : null}
        </section>
      </div>

      {composeOpen ? (
        <div className="card compose-drawer">
          <div className="toolbar"><b>写信</b><div className="grow" /><button className="ghost small" onClick={() => setComposeOpen(false)}>关闭</button></div>
          <form className="form-row" onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            sendMutation.mutate({
              account_id: String(fd.get('account_id') || defaultFrom),
              to: String(fd.get('to') || ''),
              cc: String(fd.get('cc') || ''),
              bcc: String(fd.get('bcc') || ''),
              subject: String(fd.get('subject') || ''),
              body: String(fd.get('body') || ''),
            })
          }}>
            <select name="account_id" defaultValue={defaultFrom}>{accounts.map((account) => <option key={account.account_id} value={account.account_id}>{account.email}</option>)}</select>
            <input name="to" placeholder="收件人" />
            <input name="cc" placeholder="抄送 Cc" />
            <input name="bcc" placeholder="密送 Bcc" />
            <input name="subject" placeholder="主题" />
            <textarea name="body" rows={7} placeholder="邮件正文" />
            <button disabled={sendMutation.isPending}>{sendMutation.isPending ? '发送中...' : '发送'}</button>
            <button
              type="button"
              className="secondary"
              disabled={draftMutation.isPending}
              onClick={(e) => {
                const form = e.currentTarget.form
                const fd = new FormData(form)
                draftMutation.mutate({
                  accountId: String(fd.get('account_id') || defaultFrom),
                  payload: {
                    to: String(fd.get('to') || ''),
                    cc: String(fd.get('cc') || ''),
                    bcc: String(fd.get('bcc') || ''),
                    subject: String(fd.get('subject') || ''),
                    body: String(fd.get('body') || ''),
                  },
                })
              }}
            >
              {draftMutation.isPending ? '正在保存草稿...' : '保存草稿'}
            </button>
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
