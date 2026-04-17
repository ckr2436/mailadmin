export function MailSidebar({ profile, aliases, onPasswordUpdate, passwordBusy, passwordMessage }) {
  return (
    <aside className="card">
      <h3>Account</h3>
      <div className="list">
        <div className="list-item"><b>Email</b><div>{profile?.email || ''}</div></div>
        <div className="list-item"><b>Workspace</b><div>{profile?.workspace_slug || ''}</div></div>
        <div className="list-item"><b>Domain</b><div>{profile?.domain || ''}</div></div>
        <div className="list-item">
          <b>Status</b>
          <div>{profile?.active ? <span className="badge green">active</span> : <span className="badge red">disabled</span>}</div>
        </div>
      </div>
      <hr />
      <h3>Aliases</h3>
      <div className="list">
        {(aliases || []).length
          ? aliases.map((item) => (
            <div key={`${item.source}-${item.destination}`} className="list-item">
              <b>{item.source}</b>
              <div className="smalltext">→ {item.destination}</div>
            </div>
          ))
          : <div className="muted">No aliases</div>}
      </div>
      <hr />
      <h3>Password</h3>
      <form className="form-row" onSubmit={onPasswordUpdate}>
        <div><input name="current_password" type="password" placeholder="Current password" /></div>
        <div><input name="new_password" type="password" placeholder="New password" /></div>
        <div><button disabled={passwordBusy}>{passwordBusy ? 'Updating...' : 'Update password'}</button></div>
      </form>
      {passwordMessage?.text ? <div className={passwordMessage.kind} style={{ marginTop: 10 }}>{passwordMessage.text}</div> : null}
    </aside>
  )
}
