import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { buildPlainMailNodes, sanitizeMailHTML } from './mailLinks'
import { getSendNoticeOnError, getSendNoticeOnMutate, getSendNoticeOnSuccess } from './sendNoticeState'
import '../styles.css'

const queryClient = new QueryClient()

function formatDateLabel(value) {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return value
  return dt.toLocaleString('zh-CN')
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
