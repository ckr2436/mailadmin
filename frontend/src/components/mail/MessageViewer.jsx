export function MessageViewer({ message }) {
  return (
    <div className="card webmail-pane">
      <b>Message</b>
      <div className="mail-viewer mail-viewer-spaced">
        {message ? (
          <>
            <div className="mail-viewer-meta"><b>{message.subject || '(No subject)'}</b></div>
            <div className="mail-viewer-meta">From: {message.from || ''}</div>
            <div className="mail-viewer-meta">Date: {message.date || ''}</div>
            <hr />
            <pre className="mail-body">{message.body || ''}</pre>
          </>
        ) : <span className="muted">Select a message from inbox.</span>}
      </div>
    </div>
  )
}
