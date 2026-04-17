import { useState } from 'react'

export function LoginForm({ onSubmit, busy }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    if (!email.trim() || !password) {
      setError('Please enter your email address and password.')
      return
    }

    try {
      await onSubmit({ email: email.trim(), password })
      setPassword('')
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  return (
    <form className="form-row" onSubmit={submit}>
      <div>
        <input
          placeholder="Email address"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div>
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div>
        <button disabled={busy} type="submit">{busy ? 'Signing in...' : 'Sign in'}</button>
      </div>
      {error ? <div className="error">{error}</div> : null}
    </form>
  )
}
