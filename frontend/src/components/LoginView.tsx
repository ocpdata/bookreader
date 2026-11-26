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
import { getAuthConfig, type BillingPlan, type RegistrationMode } from '../api'
import { useAuth } from '../auth'
import GoogleSignIn, { googleErrorMessage } from './GoogleSignIn'
import PremiumPlanSummary from './PremiumPlanSummary'

export default function LoginView() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const shareLink = new URLSearchParams(location.search).get('from') === 'share'
  const requestedCheckout = new URLSearchParams(location.search).get('checkout')
  const checkoutPlan: BillingPlan | null =
    requestedCheckout === 'monthly' || requestedCheckout === 'yearly' ? requestedCheckout : null
  const from = shareLink
    ? '/invitaciones'
    : checkoutPlan
      ? `/cuenta?checkout=${checkoutPlan}`
      : (location.state as { from?: string } | null)?.from ?? '/'
  const shareRegistration = shareLink || from === '/invitaciones' || from === '/compartidos'
  const registrationPath = shareRegistration
    ? '/registro?from=share'
    : checkoutPlan
      ? `/registro?plan=${checkoutPlan}`
      : '/registro'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(() => googleErrorMessage(new URLSearchParams(location.search).get('error')))
  const [busy, setBusy] = useState(false)
  const [registration, setRegistration] = useState<RegistrationMode>('closed')
  const [google, setGoogle] = useState(false)
  const [configError, setConfigError] = useState(false)

  useEffect(() => {
    getAuthConfig()
      .then((config) => {
        setRegistration(config.registration)
        setGoogle(config.google)
      })
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

  function changeCheckoutPlan(plan: BillingPlan) {
    navigate(`/entrar?checkout=${plan}`, { replace: true })
  }

  const loginForm = (
    <form onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <Typography variant="h5" component="h1">
          {checkoutPlan ? 'Inicia sesión para continuar' : 'Iniciar sesión'}
        </Typography>
        {checkoutPlan && (
          <Typography variant="body2" color="text.secondary">
            Conservamos el plan que elegiste. Después de entrar podrás revisar y confirmar el pago en Stripe si tu cuenta aún necesita contratar Premium.
          </Typography>
        )}
        {shareRegistration && (
          <Alert severity="info">Usa el mismo correo que recibió la invitación.</Alert>
        )}
        {google && <GoogleSignIn source={shareRegistration ? 'share' : undefined} plan={checkoutPlan} />}
        <TextField
          label="Correo"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus={!checkoutPlan}
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
          {checkoutPlan ? 'Entrar y continuar' : 'Entrar'}
        </Button>
        <Link component={RouterLink} to="/olvide" variant="body2">
          Olvidé mi contraseña
        </Link>
        {registration !== 'closed' && (
          <Typography variant="body2">
            ¿No tienes cuenta?{' '}
            <Link component={RouterLink} to={registrationPath}>
              {shareRegistration ? 'Crear cuenta de prueba' : checkoutPlan ? 'Crear cuenta para Premium' : 'Crear cuenta'}
            </Link>
          </Typography>
        )}
      </Stack>
    </form>
  )

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', px: 2, py: 4 }}>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, width: '100%', maxWidth: checkoutPlan ? 960 : 400 }}>
        {checkoutPlan ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, .95fr) minmax(0, 1.05fr)' }, gap: { xs: 3, md: 4 }, alignItems: 'start' }}>
            <PremiumPlanSummary plan={checkoutPlan} onPlanChange={changeCheckoutPlan} stage="login" />
            {loginForm}
          </Box>
        ) : (
          loginForm
        )}
      </Paper>
    </Box>
  )
}
