import { useState, type FormEvent } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import { forgotPassword } from '../api'
import AuthCard from './AuthCard'

export default function ForgotPasswordView() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      setSent((await forgotPassword(email)).message)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="Olvidé mi contraseña">
      {sent ? (
        <Alert severity="success">{sent}</Alert>
      ) : (
        <form onSubmit={handleSubmit}>
          <TextField
            label="Correo de tu cuenta"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            fullWidth
            sx={{ mb: 2 }}
          />
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Button type="submit" variant="contained" disabled={busy} fullWidth>
            Enviarme el enlace
          </Button>
        </form>
      )}
      <Link component={RouterLink} to="/entrar" variant="body2">
        Volver a iniciar sesión
      </Link>
    </AuthCard>
  )
}
