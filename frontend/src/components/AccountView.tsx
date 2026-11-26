import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { changePassword, confirmCheckout, createAppPassword, deleteAccount, getBillingConfig, googleReauthUrl, getMobileConfig, getUsage, listAppPasswords, listDevices, openBillingPortal, revokeAllDevices, revokeAppPassword, revokeDevice, startCheckout, type AppPassword, type LinkedDevice, type Usage } from '../api'
import { useAuth } from '../auth'
import { PREMIUM_PRICING } from '../billing-plans'
import { formatBytes } from '../format'

const MIN_LENGTH = 12

/** Tarjeta de una sección de la cuenta; `danger` resalta la zona de peligro. */
function SectionCard({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <Paper
      variant="outlined"
      component="section"
      sx={{
        p: { xs: 2.5, sm: 3 },
        borderRadius: '16px',
        boxShadow: '0 4px 20px rgba(23, 32, 51, 0.035)',
        ...(danger ? { borderColor: 'error.light' } : {}),
      }}
    >
      {children}
    </Paper>
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

const REAUTH_ERRORS: Record<string, string> = {
  cancelled: 'Cancelaste la confirmación con Google.',
  too_many: 'Demasiados intentos. Inténtalo de nuevo en un rato.',
  unavailable: 'La confirmación con Google no está disponible por ahora.',
}

/**
 * Zona de peligro: eliminar la cuenta y todo su contenido. Se confirma con la contraseña o, si la cuenta no tiene
 * (entra con Google), volviendo a identificarse con Google justo antes.
 */
function DeleteAccountSection() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const withGoogle = user?.hasPassword === false
  const [open, setOpen] = useState(false)
  const [confirmedByGoogle, setConfirmedByGoogle] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Al volver de Google el servidor deja el resultado en ?reauth=…; se recoge y se limpia la dirección.
  useEffect(() => {
    const result = params.get('reauth')
    if (!result) return
    setOpen(true)
    if (result === 'ok') setConfirmedByGoogle(true)
    else setError(REAUTH_ERRORS[result] ?? 'No se pudo confirmar con Google. Usa la misma cuenta de Google con la que entraste.')
    const next = new URLSearchParams(params)
    next.delete('reauth')
    setParams(next, { replace: true })
  }, [params, setParams])

  function close() {
    if (busy) return
    setOpen(false)
    setPassword('')
    setError('')
    setConfirmedByGoogle(false)
  }

  async function confirm(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await deleteAccount(withGoogle ? undefined : password)
      // La sesión ya no existe en el servidor: se vuelve a la portada y se limpia la local.
      navigate('/', { replace: true })
      await logout()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="h6" component="h2" color="error">
        Eliminar mi cuenta
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Se borran tu cuenta y todo tu contenido: audios, portadas, carpetas, etiquetas, marcadores y progreso. No se puede deshacer.
      </Typography>
      <Button color="error" variant="outlined" onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start' }}>
        Eliminar mi cuenta
      </Button>
      <Dialog open={open} onClose={close} aria-labelledby="delete-account-title" fullWidth maxWidth="xs">
        <form onSubmit={confirm}>
          <DialogTitle id="delete-account-title">¿Eliminar tu cuenta?</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Se eliminarán de forma definitiva tus audios y todos tus datos, y se cerrarán tus sesiones web y de apps. Las copias técnicas de los
              archivos pueden tardar hasta 14 días en desaparecer.{' '}
              {!withGoogle
                ? 'Escribe tu contraseña para confirmar.'
                : confirmedByGoogle
                  ? 'Identidad confirmada con Google. Tienes unos minutos para completar la eliminación.'
                  : 'Para confirmar, vuelve a identificarte con la cuenta de Google con la que entras.'}
            </DialogContentText>
            {!withGoogle && (
              <TextField
                label="Contraseña"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
                autoFocus
              />
            )}
            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={close} disabled={busy}>
              Cancelar
            </Button>
            {withGoogle && !confirmedByGoogle ? (
              <Button component="a" href={googleReauthUrl} variant="contained">
                Confirmar con Google
              </Button>
            ) : (
              <Button type="submit" color="error" variant="contained" disabled={busy || (!withGoogle && !password)}>
                Eliminar definitivamente
              </Button>
            )}
          </DialogActions>
        </form>
      </Dialog>
    </Stack>
  )
}

const PLAN_LABEL: Record<Usage['plan'], string> = {
  NONE: 'Sin plan',
  TRIAL: 'Prueba gratuita',
  PREMIUM: 'Premium',
  FOUNDER: 'Cuenta fundadora',
}

/** Plan comercial de la cuenta: tipo, vencimiento, suscripción y gestión de pagos. */
function PlanSection({ usage }: { usage: Usage }) {
  const [billingEnabled, setBillingEnabled] = useState(false)
  const [billingError, setBillingError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const expires = usage.planExpiresAt ? new Date(usage.planExpiresAt) : null
  const daysLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86400000)) : null

  useEffect(() => {
    getBillingConfig()
      .then((config) => setBillingEnabled(config.enabled))
      .catch(() => setBillingError(true))
  }, [])

  async function go(action: () => Promise<{ url: string }>) {
    setBusy(true)
    setError('')
    try {
      window.location.assign((await action()).url)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Stack spacing={1}>
      <Typography variant="h6" component="h2">
        Mi plan
      </Typography>
      <Typography>
        {PLAN_LABEL[usage.plan]}
        {expires && !usage.uploadsBlocked &&
          ` · termina el ${expires.toLocaleDateString('es', { dateStyle: 'medium' })} (${daysLeft} ${daysLeft === 1 ? 'día' : 'días'})`}
        {usage.plan === 'FOUNDER' && ' · sin vencimiento'}
      </Typography>
      {billingError && (
        <Alert severity="error">No se pudo comprobar la disponibilidad de pagos. Recarga la página para intentarlo de nuevo.</Alert>
      )}
      {usage.uploadsBlocked && (
        <Alert severity="warning">
          {usage.plan === 'NONE'
            ? 'Completa una suscripción Premium para empezar a subir audios.'
            : usage.plan === 'TRIAL'
              ? 'Tu prueba gratuita terminó. Puedes seguir escuchando y descargando tus audios; suscríbete para volver a subir.'
              : 'Tu plan venció. Puedes seguir escuchando y descargando tus audios; renueva para volver a subir.'}
        </Alert>
      )}
      {billingEnabled && usage.plan !== 'FOUNDER' && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {(usage.plan === 'TRIAL' || usage.plan === 'NONE') && (
            <>
              <Button variant="contained" disabled={busy} onClick={() => void go(() => startCheckout('monthly'))}>
                {usage.plan === 'NONE' ? `Contratar · ${PREMIUM_PRICING.monthly.accountLabel}` : `Suscribirme · ${PREMIUM_PRICING.monthly.accountLabel}`}
              </Button>
              <Button variant="outlined" disabled={busy} onClick={() => void go(() => startCheckout('yearly'))}>
                {usage.plan === 'NONE'
                  ? `Contratar anual · ${PREMIUM_PRICING.yearly.accountLabel}`
                  : `Plan anual · ${PREMIUM_PRICING.yearly.accountLabel} (2 meses gratis)`}
              </Button>
            </>
          )}
          {usage.plan === 'PREMIUM' && (
            <>
              {usage.uploadsBlocked && (
                <Button variant="contained" disabled={busy} onClick={() => void go(() => startCheckout('monthly'))}>
                  Renovar suscripción
                </Button>
              )}
              <Button variant="outlined" disabled={busy} onClick={() => void go(openBillingPortal)}>
                Gestionar suscripción y facturas
              </Button>
            </>
          )}
        </Stack>
      )}
      {billingEnabled && usage.plan === 'TRIAL' && (
        <Typography variant="caption" color="text.secondary">
          El pago lo procesa Stripe en pesos mexicanos ({PREMIUM_PRICING.monthly.amount} ≈ US$4); desde otros países el banco convierte el cargo.
        </Typography>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  )
}

/** Espacio y audios usados frente a la cuota de la cuenta. */
function UsageSection() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [params, setParams] = useSearchParams()
  const [paid, setPaid] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const checkoutStarted = useRef(false)

  useEffect(() => {
    const sessionId = params.get('session_id')
    const returning = params.get('pago') === 'exitoso' && sessionId
    const load = () => getUsage().then(setUsage).catch(() => undefined)
    if (!returning) {
      void load()
      return
    }
    // Al volver de Stripe se confirma el pago con el servidor (por si el webhook aún no llegó).
    confirmCheckout(sessionId)
      .then(() => setPaid(true))
      .catch(() => undefined)
      .finally(() => {
        setParams({}, { replace: true })
        void load()
      })
  }, [params, setParams])

  useEffect(() => {
    const checkoutPlan = params.get('checkout')
    if (!usage || (checkoutPlan !== 'monthly' && checkoutPlan !== 'yearly')) return
    const nextParams = new URLSearchParams(params)
    nextParams.delete('checkout')
    if (usage.plan !== 'NONE' && usage.plan !== 'TRIAL') {
      setParams(nextParams, { replace: true })
      return
    }
    if (checkoutStarted.current) return
    checkoutStarted.current = true
    startCheckout(checkoutPlan)
      .then(({ url }) => window.location.assign(url))
      .catch((error: Error) => {
        setCheckoutError(error.message)
        setParams(nextParams, { replace: true })
      })
  }, [params, setParams, usage])

  if (!usage) return null
  const percent = Math.min(100, (usage.usedBytes / usage.limitBytes) * 100)
  const nearlyFull = percent >= 90 || usage.audios >= usage.maxAudios
  return (
    <Stack spacing={3}>
      {paid && <Alert severity="success">¡Gracias! Tu suscripción está activa.</Alert>}
      {checkoutError && <Alert severity="error">{checkoutError}</Alert>}
      <SectionCard>
        <PlanSection usage={usage} />
      </SectionCard>
      <SectionCard>
      <Stack spacing={1.5}>
      <Typography variant="h6" component="h2">
        Almacenamiento
      </Typography>
      <LinearProgress variant="determinate" value={percent} color={nearlyFull ? 'warning' : 'primary'} aria-label="Espacio usado" sx={{ height: 10, borderRadius: 5 }} />
      <Typography variant="body2">
        Usas {formatBytes(usage.usedBytes)} de {formatBytes(usage.limitBytes)} · {usage.audios} de {usage.maxAudios} audios
      </Typography>
      {usage.trashAudios > 0 && (
        <Typography variant="caption" color="text.secondary">
          Incluye {usage.trashAudios} {usage.trashAudios === 1 ? 'audio' : 'audios'} en la papelera ({formatBytes(usage.trashBytes)}): siguen
          ocupando espacio hasta que los elimines de forma definitiva.
        </Typography>
      )}
      {nearlyFull && <Alert severity="warning">Estás cerca del límite de tu cuenta.</Alert>}
      </Stack>
      </SectionCard>
    </Stack>
  )
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'medium' }) : 'nunca'

function MobileAppsSection() {
  const { user } = useAuth()
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getMobileConfig>> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getMobileConfig()
      .then((result) => { if (active) setConfig(result) })
      .catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])

  return (
    <Stack spacing={1.5} component="section">
      <Typography variant="h6" component="h2">Escuchar en el móvil</Typography>
      {error && <Alert severity="error">No se pudo consultar la compatibilidad móvil: {error}</Alert>}
      {!config && !error && <Typography color="text.secondary">Consultando compatibilidad móvil…</Typography>}
      {config && !config.enabled && <Alert severity="info">La compatibilidad con aplicaciones móviles está desactivada.</Alert>}
      {config?.enabled && (
        <>
          <Typography variant="body2" color="text.secondary">
            Conecta una aplicación de terceros compatible con Audiobookshelf para escuchar tu biblioteca.
            La disponibilidad y las funciones pueden variar según la app y la región.
          </Typography>
          <Typography variant="subtitle2">Absorb · Android y iPhone</Typography>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Button component="a" href="https://play.google.com/store/apps/details?id=com.barnabas.absorb" target="_blank" rel="noopener noreferrer" size="small" variant="outlined">Google Play</Button>
            <Button component="a" href="https://apps.apple.com/app/absorb-for-audiobookshelf/id6760673498" target="_blank" rel="noopener noreferrer" size="small" variant="outlined">App Store</Button>
          </Stack>
          <Typography variant="subtitle2">AudioBooth · iPhone</Typography>
          <Button component="a" href="https://apps.apple.com/app/audiobooth-audiobooks-player/id6753017503" target="_blank" rel="noopener noreferrer" size="small" variant="outlined" sx={{ alignSelf: 'flex-start' }}>App Store</Button>
          {config.serverUrl ? (
            <>
              <Typography variant="subtitle2">Cómo conectarte</Typography>
              <Box component="ol" sx={{ pl: 2.5, my: 0 }}>
                <Typography component="li" variant="body2">Instala y abre la app; elige conectar un servidor de Audiobookshelf.</Typography>
                <Typography component="li" variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                  En servidor, introduce <strong>{config.serverUrl}</strong>.
                </Typography>
                <Typography component="li" variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                  Inicia sesión con tu correo de BookBrief{user?.email ? <> (<strong>{user.email}</strong>)</> : ''} y tu contraseña de BookBrief o un código de aplicación (más abajo).
                </Typography>
                <Typography component="li" variant="body2" sx={{ mt: 1 }}>Abre la biblioteca «Resúmenes» para escuchar tus audios.</Typography>
              </Box>
            </>
          ) : (
            <Alert severity="warning">No hay una dirección HTTPS para móviles configurada. Contacta al administrador del servicio.</Alert>
          )}
          <Divider />
          <AppPasswordsSection />
          <Typography variant="body2" color="text.secondary">
            Puedes sincronizar tu progreso y, si la app lo permite, descargar audios. Para subir, editar o eliminar contenido,
            usa BookBrief en la web. Algunas funciones de las apps no están disponibles en BookBrief.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Administra el acceso en «Sesiones de apps». Al cerrar una sesión se revoca su acceso al servidor, pero sus
            descargas pueden permanecer en el dispositivo.
          </Typography>
        </>
      )}
    </Stack>
  )
}

function AppPasswordsSection() {
  const { user } = useAuth()
  const [codes, setCodes] = useState<AppPassword[] | null>(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<{ name: string; code: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () =>
    listAppPasswords()
      .then(setCodes)
      .catch((e: Error) => setError(e.message))

  useEffect(() => {
    void load()
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await createAppPassword(name)
      setCreated({ name: result.name, code: result.code })
      setCopied(false)
      setName('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setBusy(true)
    setError('')
    try {
      await revokeAppPassword(id)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">Códigos de aplicación</Typography>
      <Typography variant="body2" color="text.secondary">
        {user?.hasPassword === false
          ? 'Tu cuenta entra con Google, así que las apps no pueden usar una contraseña. Crea un código para cada dispositivo y escríbelo en el campo de contraseña de la app, junto con tu correo.'
          : 'Si prefieres no escribir tu contraseña en la app, crea un código para cada dispositivo y úsalo en su lugar.'}{' '}
        El código solo funciona en las apps, no en la web, y se muestra una sola vez.
      </Typography>
      <form onSubmit={create}>
        <Stack direction="row" spacing={1}>
          <TextField label="Nombre del dispositivo" size="small" value={name} onChange={(e) => setName(e.target.value)} placeholder="iPhone de Ana" slotProps={{ htmlInput: { maxLength: 100 } }} fullWidth />
          <Button type="submit" variant="outlined" disabled={busy} sx={{ whiteSpace: 'nowrap' }}>Crear código</Button>
        </Stack>
      </form>
      {error && <Alert severity="error">{error}</Alert>}
      {created && (
        <Alert severity="success" onClose={() => setCreated(null)}>
          <Typography variant="body2">Código para «{created.name}». Cópialo ahora: no volverá a mostrarse.</Typography>
          <Typography component="p" sx={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700, my: 1, overflowWrap: 'anywhere' }}>{created.code}</Typography>
          <Button size="small" onClick={() => copy(created.code)}>{copied ? 'Copiado' : 'Copiar'}</Button>
        </Alert>
      )}
      {codes?.map((c) => (
        <Stack key={c.id} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ overflowWrap: 'anywhere' }}>{c.name}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Creado: {formatDate(c.createdAt)} · último uso: {formatDate(c.lastUsedAt)}
            </Typography>
          </Box>
          <Button color="error" size="small" disabled={busy} onClick={() => revoke(c.id)} aria-label={`Revocar el código de ${c.name}`}>
            Revocar
          </Button>
        </Stack>
      ))}
      {codes && codes.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Revocar un código impide iniciar sesión con él. Las sesiones que ya abrió siguen activas hasta que las cierres en «Sesiones de apps».
        </Typography>
      )}
    </Stack>
  )
}

function AppSessionsSection() {
  const [devices, setDevices] = useState<LinkedDevice[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () =>
    listDevices()
      .then(setDevices)
      .catch((e: Error) => setError(e.message))

  useEffect(() => {
    void load()
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={1.5} component="section">
      <Typography variant="h6" component="h2">
        Sesiones de apps
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Cada inicio de sesión crea una entrada: una misma app o dispositivo puede aparecer varias veces. El nombre lo
        proporciona la app y no identifica necesariamente un dispositivo único.
      </Typography>
      <Typography variant="body2" color="text.secondary">
        El último uso se actualiza como máximo una vez por hora y no indica si la app está conectada ahora.
        Al cerrar una sesión se revoca su acceso al servidor; sus audios descargados pueden permanecer en el dispositivo.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {devices?.length === 0 && <Typography color="text.secondary">No hay sesiones de apps.</Typography>}
      {devices?.map((d) => (
        <Stack key={d.id} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ overflowWrap: 'anywhere' }}>{d.name}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Inicio: {formatDate(d.createdAt)} · último uso registrado: {formatDate(d.lastUsedAt)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
              ID de sesión: {d.id}
            </Typography>
          </Box>
          <Button color="error" size="small" disabled={busy} onClick={() => run(() => revokeDevice(d.id))}
            aria-label={`Cerrar sesión de ${d.name}, ID ${d.id}`}>
            Cerrar sesión
          </Button>
        </Stack>
      ))}
      {devices && devices.length > 1 && (
        <Button color="error" size="small" disabled={busy} onClick={() => run(revokeAllDevices)} sx={{ alignSelf: 'flex-start' }}>
          Cerrar todas las sesiones de apps
        </Button>
      )}
    </Stack>
  )
}

export default function AccountView() {
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setDone(false)
    if (next.length < MIN_LENGTH) return setError(`La contraseña nueva debe tener al menos ${MIN_LENGTH} caracteres`)
    if (next !== confirm) return setError('Las contraseñas nuevas no coinciden')
    setBusy(true)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 1000, mx: 'auto' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Avatar sx={{ bgcolor: 'primary.main', width: 56, height: 56, fontWeight: 700 }}>{initials(user?.name ?? '') || '?'}</Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h1">
            Mi cuenta
          </Typography>
          <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {user?.name} · {user?.email}
          </Typography>
        </Box>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: 3, alignItems: 'start' }}>
        <Stack spacing={3}>
          <UsageSection />
          <SectionCard>
            <form onSubmit={handleSubmit}>
              <Stack spacing={2}>
                <Typography variant="h6" component="h2">
                  Contraseña
                </Typography>
                {user?.hasPassword === false ? (
                  <Alert severity="info">
                    Entras con Google, por eso tu cuenta no tiene contraseña ni la necesita: en las apps móviles usa un código de
                    aplicación. Si aun así quieres tener una, créala con <Link component={RouterLink} to="/olvide">«Olvidé mi contraseña»</Link>.
                  </Alert>
                ) : (
                  <>
                    {/* Campo oculto de usuario: los gestores de contraseñas lo usan para asociar la nueva. */}
                    <input type="text" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
                    <TextField
                      label="Contraseña actual"
                      type="password"
                      autoComplete="current-password"
                      value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                      required
                    />
                    <TextField
                      label="Contraseña nueva"
                      type="password"
                      autoComplete="new-password"
                      value={next}
                      onChange={(e) => setNext(e.target.value)}
                      helperText={`Al menos ${MIN_LENGTH} caracteres.`}
                      required
                    />
                    <TextField
                      label="Repite la contraseña nueva"
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                    />
                    {error && <Alert severity="error">{error}</Alert>}
                    {done && <Alert severity="success">Contraseña actualizada. Se cerraron tus otras sesiones.</Alert>}
                    <Button type="submit" variant="contained" disabled={busy} sx={{ alignSelf: 'flex-start' }}>
                      Guardar contraseña
                    </Button>
                  </>
                )}
              </Stack>
            </form>
          </SectionCard>
        </Stack>
        <Stack spacing={3}>
          <SectionCard>
            <MobileAppsSection />
          </SectionCard>
          <SectionCard>
            <AppSessionsSection />
          </SectionCard>
          <SectionCard danger>
            <DeleteAccountSection />
          </SectionCard>
        </Stack>
      </Box>
    </Stack>
  )
}
