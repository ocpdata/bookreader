import { useEffect, useState, type FormEvent } from 'react'
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { getAuthConfig, type RegistrationMode } from '../api'
import { useAuth } from '../auth'

export default function LoginView() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const shareLink = new URLSearchParams(location.search).get('from') === 'share'
  const from = shareLink ? '/invitaciones' : (location.state as { from?: string } | null)?.from ?? '/'
  const shareRegistration = shareLink || from === '/invitaciones' || from === '/compartidos'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [registration, setRegistration] = useState<RegistrationMode>('closed')
  const [configError, setConfigError] = useState(false)

  useEffect(() => {
    getAuthConfig()
      .then((config) => setRegistration(config.registration))
      .catch(() => setConfigError(true))
  }, [])

  if (user) return <Navigate to={from} replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
      <Paper variant="outlined" sx={{ p: 3, width: '100%', maxWidth: 400 }}>
        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <Typography variant="h5" component="h1">
              Iniciar sesión
            </Typography>
            {shareRegistration && (
              <Alert severity="info">Usa el mismo correo que recibió la invitación.</Alert>
            )}
            <TextField
              label="Correo"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <TextField
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <Alert severity="error">{error}</Alert>}
            {configError && <Alert severity="error">No se pudo comprobar si el registro está disponible. Recarga la página para intentarlo de nuevo.</Alert>}
            <Button type="submit" variant="contained" disabled={busy}>
              Entrar
            </Button>
            <Link component={RouterLink} to="/olvide" variant="body2">
              Olvidé mi contraseña
            </Link>
            {registration !== 'closed' && (
              <Typography variant="body2">
                ¿No tienes cuenta?{' '}
                <Link component={RouterLink} to={shareRegistration ? '/registro?from=share' : '/registro'}>
                  {shareRegistration ? 'Crear cuenta de prueba' : 'Crear cuenta'}
                </Link>
              </Typography>
            )}
          </Stack>
        </form>
      </Paper>
    </Box>
  )
}
