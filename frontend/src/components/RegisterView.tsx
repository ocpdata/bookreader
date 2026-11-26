import { useEffect, useState, type FormEvent } from 'react'
import { Link as RouterLink, Navigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { getAuthConfig, registerAccount, resendVerification, type BillingPlan, type RegistrationMode } from '../api'
import { useAuth } from '../auth'
import AuthCard from './AuthCard'
import GoogleSignIn from './GoogleSignIn'
import PremiumPlanSummary from './PremiumPlanSummary'
import TrialPlanSummary from './TrialPlanSummary'

const MIN_LENGTH = 12

export default function RegisterView() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const source = params.get('from') === 'share' ? 'share' : undefined
  const planParam = params.get('plan')
  const checkoutPlan: BillingPlan | null =
    planParam === 'monthly' || planParam === 'yearly' ? planParam : null
  const loginPath = source ? '/entrar?from=share' : checkoutPlan ? `/entrar?checkout=${checkoutPlan}` : '/entrar'

  function changeCheckoutPlan(plan: BillingPlan) {
    const nextParams = new URLSearchParams(params)
    nextParams.set('plan', plan)
    setParams(nextParams, { replace: true })
  }
  const [mode, setMode] = useState<RegistrationMode | 'error' | undefined>(undefined)
  const [google, setGoogle] = useState(false)
  const [configAttempt, setConfigAttempt] = useState(0)
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
      .then((config) => {
        setMode(config.registration)
        setGoogle(config.google)
      })
      .catch(() => setMode('error'))
  }, [configAttempt])

  if (user) return <Navigate to={checkoutPlan ? `/cuenta?checkout=${checkoutPlan}` : source ? '/invitaciones' : '/'} replace />
  if (mode === undefined) return <CircularProgress size={28} sx={{ display: 'block', mx: 'auto', mt: 4 }} />
  if (mode === 'error') {
    return (
      <AuthCard
        title={checkoutPlan ? 'Continúa con Premium' : 'Empieza tu prueba gratis'}
        width={760}
      >
        {checkoutPlan && <PremiumPlanSummary plan={checkoutPlan} onPlanChange={changeCheckoutPlan} />}
        {!checkoutPlan && <TrialPlanSummary shared={Boolean(source)} />}
        <Alert severity="error">No se pudo comprobar si el registro está disponible.</Alert>
        <Button onClick={() => { setMode(undefined); setConfigAttempt((attempt) => attempt + 1) }}>Reintentar</Button>
        <Link component={RouterLink} to={loginPath}>Ya tengo una cuenta</Link>
      </AuthCard>
    )
  }
  if (mode === 'closed') {
    return (
      <AuthCard
        title={checkoutPlan ? 'Continúa con Premium' : 'Empieza tu prueba gratis'}
        width={760}
      >
        {checkoutPlan && <PremiumPlanSummary plan={checkoutPlan} onPlanChange={changeCheckoutPlan} />}
        {!checkoutPlan && <TrialPlanSummary shared={Boolean(source)} />}
        <Alert severity="info">El registro no está disponible por ahora.</Alert>
        <Link component={RouterLink} to={loginPath}>
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
      const res = await registerAccount({ email, name, password, acceptTerms: true, ...(mode === 'invite' ? { inviteCode } : {}), ...(source ? { source } : {}), ...(checkoutPlan ? { plan: checkoutPlan } : {}) })
      setSent(res.message)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthCard
        title={checkoutPlan ? 'Un paso más para activar Premium' : 'Tu prueba empieza al verificar'}
        width={960}
      >
        {checkoutPlan ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, .9fr) minmax(0, 1.1fr)' }, gap: 3, alignItems: 'start' }}>
            <PremiumPlanSummary plan={checkoutPlan} stage="verification" />
            <Stack spacing={2}>
              <Alert severity="success">{sent}</Alert>
              <Typography variant="body2" color="text.secondary">
                Enviamos un enlace a <strong>{email}</strong>. Verifica tu correo y después inicia sesión para completar el pago de Premium en Stripe.
              </Typography>
              <Typography variant="body2">1. Verifica tu correo</Typography>
              <Typography variant="body2">2. Inicia sesión con esta cuenta</Typography>
              <Typography variant="body2">3. Completa el pago para activar Premium</Typography>
              {resent && <Alert severity="info">Si la cuenta sigue sin verificar, te enviamos otro enlace.</Alert>}
              <Button
                size="small"
                sx={{ alignSelf: 'flex-start' }}
                onClick={() => resendVerification(email, source).then(() => setResent(true), (err: Error) => setError(err.message))}
              >
                Reenviar el correo
              </Button>
              {error && <Alert severity="error">{error}</Alert>}
              <Link component={RouterLink} to={loginPath}>
                Ir a iniciar sesión
              </Link>
            </Stack>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, .9fr) minmax(0, 1.1fr)' }, gap: 3, alignItems: 'start' }}>
            <TrialPlanSummary stage="verification" shared={Boolean(source)} />
            <Stack spacing={2}>
              <Alert severity="success">{sent}</Alert>
              <Typography variant="body2" color="text.secondary">
                Enviamos un enlace a <strong>{email}</strong>. Verifica tu correo para activar la cuenta. Si este correo no ha usado una prueba, los 30 días empezarán al verificarlo.
              </Typography>
              <Typography variant="body2">1. Revisa tu correo</Typography>
              <Typography variant="body2">2. Verifica la cuenta para iniciar la prueba</Typography>
              <Typography variant="body2">{source ? '3. Inicia sesión y acepta la invitación para escuchar los audios compartidos' : '3. Inicia sesión y empieza a organizar tus audios'}</Typography>
              {resent && <Alert severity="info">Si la cuenta sigue sin verificar, te enviamos otro enlace.</Alert>}
              <Button
                size="small"
                sx={{ alignSelf: 'flex-start' }}
                onClick={() => resendVerification(email, source).then(() => setResent(true), (err: Error) => setError(err.message))}
              >
                Reenviar el correo
              </Button>
              {error && <Alert severity="error">{error}</Alert>}
              <Link component={RouterLink} to={loginPath}>
                Ir a iniciar sesión
              </Link>
            </Stack>
          </Box>
        )}
      </AuthCard>
    )
  }

  const accountForm = (
    <>
      {mode === 'open' && google && <GoogleSignIn source={source} plan={checkoutPlan} />}
      <form onSubmit={handleSubmit}>
        <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required fullWidth autoFocus={Boolean(source) && !checkoutPlan} sx={{ mb: 2 }} />
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
          Crear cuenta y verificar correo
        </Button>
      </form>
      <Link component={RouterLink} to={loginPath} variant="body2">
        ¿Ya tienes cuenta? Inicia sesión
      </Link>
    </>
  )

  if (checkoutPlan) {
    return (
      <AuthCard title="Tu biblioteca, ahora en Premium" width={1000}>
        <Typography color="text.secondary">
          Crea tu cuenta para continuar con el plan elegido. No se te cobrará al registrarte.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, .95fr) minmax(0, 1.05fr)' }, gap: { xs: 3, md: 4 }, alignItems: 'start' }}>
          <PremiumPlanSummary plan={checkoutPlan} onPlanChange={changeCheckoutPlan} />
          <Stack spacing={2}>
            <Typography variant="h6" component="h2">Crea tu cuenta para empezar</Typography>
            {source && <Alert severity="info">Regístrate con el mismo correo que recibió la invitación. Después de verificarlo e iniciar sesión podrás aceptarla.</Alert>}
            {accountForm}
          </Stack>
        </Box>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Tu biblioteca empieza gratis" width={1000}>
      <Typography color="text.secondary">
        Prueba BookBrief con tus propios audios, sin registrar una tarjeta ni comprometerte a una suscripción.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, .95fr) minmax(0, 1.05fr)' }, gap: { xs: 3, md: 4 }, alignItems: 'start' }}>
        <TrialPlanSummary shared={Boolean(source)} />
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">Crea tu cuenta para empezar</Typography>
          {source && <Alert severity="info">Regístrate con el mismo correo que recibió la invitación. Después de verificarlo e iniciar sesión podrás aceptarla.</Alert>}
          {accountForm}
        </Stack>
      </Box>
    </AuthCard>
  )
}
