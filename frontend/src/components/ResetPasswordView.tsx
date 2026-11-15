import { useState, type FormEvent } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import { resetPassword } from '../api'
import AuthCard from './AuthCard'

const MIN_LENGTH = 12

/** Destino del enlace del correo de recuperación. */
export default function ResetPasswordView() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < MIN_LENGTH) return setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres`)
    if (password !== confirm) return setError('Las contraseñas no coinciden')
    setBusy(true)
    try {
      setDone((await resetPassword(token, password)).message)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthCard title="Restablecer contraseña">
        <Alert severity="error">El enlace no es válido.</Alert>
        <Link component={RouterLink} to="/olvide">
          Pedir un enlace nuevo
        </Link>
      </AuthCard>
    )
  }

  if (done) {
    return (
      <AuthCard title="Restablecer contraseña">
        <Alert severity="success">{done}</Alert>
        <Button component={RouterLink} to="/entrar" variant="contained">
          Iniciar sesión
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Restablecer contraseña">
      <form onSubmit={handleSubmit}>
        <TextField
          label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          helperText={`Al menos ${MIN_LENGTH} caracteres.`}
          required
          autoFocus
          fullWidth
          sx={{ mb: 2 }}
        />
        <TextField
          label="Repite la contraseña nueva"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          fullWidth
          sx={{ mb: 2 }}
        />
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Button type="submit" variant="contained" disabled={busy} fullWidth>
          Guardar contraseña
        </Button>
      </form>
      <Link component={RouterLink} to="/olvide" variant="body2">
        Pedir un enlace nuevo
      </Link>
    </AuthCard>
  )
}
