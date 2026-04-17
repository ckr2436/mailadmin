export function ComposePanel({ onSend, busy, feedback }) {
  return (
    <div className="card webmail-pane">
      <h3>Compose</h3>
      <form className="form-row" onSubmit={onSend}>
        <div><input name="to" placeholder="To" /></div>
        <div><input name="subject" placeholder="Subject" /></div>
        <div><textarea name="body" placeholder="Message body" /></div>
        <div><button disabled={busy}>{busy ? 'Sending...' : 'Send'}</button></div>
      </form>
      {feedback?.text ? <div className={feedback.kind} style={{ marginTop: 10 }}>{feedback.text}</div> : null}
    </div>
  )
}
