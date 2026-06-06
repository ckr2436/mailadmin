import { useState } from 'react'

export function LoginForm({ onSubmit, busy }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    if (!username.trim() || !password) {
      setError('请输入用户名和密码。')
      return
    }

    try {
      await onSubmit({ username: username.trim(), password })
      setPassword('')
    } catch (submitError) {
      setError(submitError.message || '登录失败，请检查用户名和密码。')
    }
  }

  return (
    <form className="form-row" onSubmit={submit}>
      <div>
        <input
          placeholder="用户名"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div>
        <input
          type="password"
          placeholder="密码"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div>
        <button disabled={busy} type="submit">{busy ? '登录中...' : '登录'}</button>
      </div>
      {error ? <div className="error">{error}</div> : null}
    </form>
  )
}
