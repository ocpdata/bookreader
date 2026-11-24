import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { changePassword, confirmCheckout, deleteAccount, getBillingConfig, getUsage, listDevices, openBillingPortal, revokeAllDevices, revokeDevice, startCheckout, type LinkedDevice, type Usage } from '../api'
import { useAuth } from '../auth'
import { formatBytes } from '../format'

const MIN_LENGTH = 12

/** Zona de peligro: eliminar la cuenta y todo su contenido, confirmando con la contraseña. */
function DeleteAccountSection() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function close() {
    if (busy) return
    setOpen(false)
    setPassword('')
    setError('')
  }

  async function confirm(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await deleteAccount(password)
      // La sesión ya no existe en el servidor: se limpia la local y se vuelve a la portada.
      await logout()
      navigate('/', { replace: true })
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
              Se eliminarán de forma definitiva tus audios y todos tus datos, y se cerrarán tus sesiones y apps vinculadas. Las copias técnicas de los
              archivos pueden tardar hasta 14 días en desaparecer. Escribe tu contraseña para confirmar.
            </DialogContentText>
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
            <Button type="submit" color="error" variant="contained" disabled={busy || !password}>
              Eliminar definitivamente
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Stack>
  )
}

const PLAN_LABEL = { TRIAL: 'Prueba gratuita', PREMIUM: 'Premium', FOUNDER: 'Cuenta fundadora' }

/** Plan comercial de la cuenta: tipo, vencimiento, suscripción y gestión de pagos. */
function PlanSection({ usage }: { usage: Usage }) {
  const [billingEnabled, setBillingEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const expires = usage.planExpiresAt ? new Date(usage.planExpiresAt) : null
  const daysLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86400000)) : null

  useEffect(() => {
    getBillingConfig()
      .then((config) => setBillingEnabled(config.enabled))
      .catch(() => undefined)
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
        {!expires && usage.plan !== 'TRIAL' && ' · sin vencimiento'}
      </Typography>
      {usage.uploadsBlocked && (
        <Alert severity="warning">
          {usage.plan === 'TRIAL'
            ? 'Tu prueba gratuita terminó. Puedes seguir escuchando y descargando tus audios; suscríbete para volver a subir.'
            : 'Tu plan venció. Puedes seguir escuchando y descargando tus audios; renueva para volver a subir.'}
        </Alert>
      )}
      {billingEnabled && usage.plan !== 'FOUNDER' && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {usage.plan === 'TRIAL' && (
            <>
              <Button variant="contained" disabled={busy} onClick={() => void go(() => startCheckout('monthly'))}>
                Suscribirme · MX$69/mes
              </Button>
              <Button variant="outlined" disabled={busy} onClick={() => void go(() => startCheckout('yearly'))}>
                Plan anual · MX$690 (2 meses gratis)
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
          El pago lo procesa Stripe en pesos mexicanos (MX$69 ≈ US$4); desde otros países el banco convierte el cargo.
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

  if (!usage) return null
  const percent = Math.min(100, (usage.usedBytes / usage.limitBytes) * 100)
  const nearlyFull = percent >= 90 || usage.audios >= usage.maxAudios
  return (
    <Stack spacing={3}>
      {paid && <Alert severity="success">¡Gracias! Tu suscripción está activa.</Alert>}
      <PlanSection usage={usage} />
      <Stack spacing={1}>
      <Typography variant="h6" component="h2">
        Almacenamiento
      </Typography>
      <LinearProgress variant="determinate" value={percent} color={nearlyFull ? 'warning' : 'primary'} aria-label="Espacio usado" />
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
    </Stack>
  )
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : 'nunca'

/** Apps vinculadas (Absorb, AudioBooth...): cada inicio de sesión desde una app crea un dispositivo que se puede revocar. */
function DevicesSection() {
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
    <Stack spacing={1.5}>
      <Typography variant="h6" component="h2">
        Apps vinculadas
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Cada app compatible con Audiobookshelf que inicia sesión queda aquí. Si pierdes un dispositivo, quítalo: dejará de
        tener acceso de inmediato.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {devices?.length === 0 && <Typography color="text.secondary">No hay apps vinculadas.</Typography>}
      {devices?.map((d) => (
        <Stack key={d.id} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <Typography>{d.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              Vinculada {formatDate(d.createdAt)} · último uso {formatDate(d.lastUsedAt)}
            </Typography>
          </div>
          <Button color="error" size="small" disabled={busy} onClick={() => run(() => revokeDevice(d.id))}>
            Quitar
          </Button>
        </Stack>
      ))}
      {devices && devices.length > 1 && (
        <Button color="error" size="small" disabled={busy} onClick={() => run(revokeAllDevices)} sx={{ alignSelf: 'flex-start' }}>
          Quitar todas
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
    <Stack spacing={4} sx={{ maxWidth: 420 }}>
      <form onSubmit={handleSubmit}>
        <Stack spacing={2}>
          <Typography variant="h5" component="h1">
            Mi cuenta
          </Typography>
          <Typography color="text.secondary">
            {user?.name} · {user?.email}
          </Typography>
          <Typography variant="h6" component="h2">
            Cambiar contraseña
          </Typography>
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
        </Stack>
      </form>
      <Divider />
      <UsageSection />
      <Divider />
      <DevicesSection />
      <Divider />
      <DeleteAccountSection />
    </Stack>
  )
}
