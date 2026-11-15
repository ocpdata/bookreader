import { useEffect, useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { changePassword, getUsage, listDevices, revokeAllDevices, revokeDevice, type LinkedDevice, type Usage } from '../api'
import { useAuth } from '../auth'
import { formatBytes } from '../format'

const MIN_LENGTH = 12

/** Espacio y audios usados frente a la cuota de la cuenta. */
function UsageSection() {
  const [usage, setUsage] = useState<Usage | null>(null)

  useEffect(() => {
    getUsage()
      .then(setUsage)
      .catch(() => undefined)
  }, [])

  if (!usage) return null
  const percent = Math.min(100, (usage.usedBytes / usage.limitBytes) * 100)
  const nearlyFull = percent >= 90 || usage.audios >= usage.maxAudios
  return (
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
    </Stack>
  )
}
