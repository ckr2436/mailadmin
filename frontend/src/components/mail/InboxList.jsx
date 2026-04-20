export function InboxList({ items, onSelect }) {
  return (
    <div className="card webmail-pane">
      <div className="toolbar inbox-toolbar">
        <b>Inbox</b>
        <div className="grow" />
        <span className="smalltext">Recent 20 messages</span>
      </div>
      <div className="mail-list">
        {items.length ? items.map((item) => (
          <button key={item.uid} className="mail-item" onClick={() => onSelect(item.uid)}>
            <div className="mail-item-subject">{item.subject || '(No subject)'}</div>
            <div className="mail-item-meta">{item.from || ''}</div>
            <div className="mail-item-preview">{item.preview || ''}</div>
          </button>
        )) : <div className="muted">No messages</div>}
      </div>
    </div>
  )
}
