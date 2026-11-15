import { useEffect, useState, type FormEvent } from 'react'
import { Link as RouterLink, Navigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { getAuthConfig, registerAccount, resendVerification, type RegistrationMode } from '../api'
import { useAuth } from '../auth'
import AuthCard from './AuthCard'

const MIN_LENGTH = 12

export default function RegisterView() {
  const { user } = useAuth()
  const [mode, setMode] = useState<RegistrationMode | undefined>(undefined)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState('')
  const [resent, setResent] = useState(false)

  useEffect(() => {
    getAuthConfig()
      .then((config) => setMode(config.registration))
      .catch(() => setMode('closed'))
  }, [])

  if (user) return <Navigate to="/" replace />
  if (mode === undefined) return <CircularProgress size={28} sx={{ display: 'block', mx: 'auto', mt: 4 }} />
  if (mode === 'closed') {
    return (
      <AuthCard title="Crear cuenta">
        <Alert severity="info">El registro no está disponible por ahora.</Alert>
        <Link component={RouterLink} to="/entrar">
          Ya tengo una cuenta
        </Link>
      </AuthCard>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < MIN_LENGTH) return setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres`)
    if (password !== confirm) return setError('Las contraseñas no coinciden')
    if (!accepted) return setError('Debes aceptar los términos y el aviso de privacidad')
    setBusy(true)
    try {
      const res = await registerAccount({ email, name, password, acceptTerms: true, ...(mode === 'invite' ? { inviteCode } : {}) })
      setSent(res.message)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthCard title="Revisa tu correo">
        <Alert severity="success">{sent}</Alert>
        <Typography variant="body2" color="text.secondary">
          Enviamos un enlace a <strong>{email}</strong>. Al abrirlo tu cuenta queda activa; después podrás entrar.
        </Typography>
        {resent && <Alert severity="info">Si la cuenta sigue sin verificar, te enviamos otro enlace.</Alert>}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => resendVerification(email).then(() => setResent(true), (err: Error) => setError(err.message))}
        >
          Reenviar el correo
        </Button>
        {error && <Alert severity="error">{error}</Alert>}
        <Link component={RouterLink} to="/entrar">
          Ir a iniciar sesión
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Crear cuenta">
      <form onSubmit={handleSubmit}>
        <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required fullWidth autoFocus sx={{ mb: 2 }} />
        <TextField label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required fullWidth sx={{ mb: 2 }} />
        <TextField
          label="Contraseña"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          helperText={`Al menos ${MIN_LENGTH} caracteres.`}
          required
          fullWidth
          sx={{ mb: 2 }}
        />
        <TextField
          label="Repite la contraseña"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          fullWidth
          sx={{ mb: 2 }}
        />
        {mode === 'invite' && (
          <TextField
            label="Código de invitación"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            helperText="Formato BR-XXXX-XXXX-XXXX."
            required
            fullWidth
            sx={{ mb: 2 }}
          />
        )}
        <FormControlLabel
          control={<Checkbox checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />}
          label={
            <Typography variant="body2">
              Acepto los{' '}
              <Link component={RouterLink} to="/terminos" target="_blank">
                términos
              </Link>{' '}
              y el{' '}
              <Link component={RouterLink} to="/privacidad" target="_blank">
                aviso de privacidad
              </Link>
            </Typography>
          }
        />
        {error && (
          <Alert severity="error" sx={{ my: 2 }}>
            {error}
          </Alert>
        )}
        <Button type="submit" variant="contained" disabled={busy} fullWidth sx={{ mt: 1 }}>
          Crear cuenta
        </Button>
      </form>
      <Link component={RouterLink} to="/entrar" variant="body2">
        Ya tengo una cuenta
      </Link>
    </AuthCard>
  )
}
