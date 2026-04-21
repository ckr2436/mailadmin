import { useState } from 'react'

export function LoginForm({ onSubmit, busy }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    if (!email.trim() || !password) {
      setError('请输入邮箱地址和密码。')
      return
    }

    try {
      await onSubmit({ email: email.trim(), password })
      setPassword('')
    } catch (submitError) {
      setError(submitError.message || '登录失败，请检查邮箱和密码。')
    }
  }

  return (
    <form className="form-row" onSubmit={submit}>
      <div>
        <input
          placeholder="邮箱地址"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
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
