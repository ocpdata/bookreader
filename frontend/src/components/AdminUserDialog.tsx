import { useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { changeUserRole, setUserPlan, setUserQuota, setUserStatus, type AdminPlan, type AdminUser } from '../api'
import { formatBytes } from '../format'

export type AdminAction = 'role' | 'status' | 'plan' | 'quota'

export const PLAN_LABEL: Record<AdminPlan, string> = {
  NONE: 'Sin plan',
  TRIAL: 'Prueba gratuita',
  PREMIUM: 'Premium',
  FOUNDER: 'Fundador',
}

interface Props {
  user: AdminUser
  action: AdminAction
  onClose: () => void
  /** Se llama tras aplicar el cambio, con el aviso que se mostrará. */
  onDone: (notice: string) => void
}

/** Un único diálogo para las cuatro acciones sobre una cuenta; cada una confirma antes de aplicar. */
export default function AdminUserDialog({ user, action, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const suspended = user.status === 'SUSPENDED'

  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [plan, setPlan] = useState<AdminPlan>(user.plan)
  const [days, setDays] = useState('')
  const [storageGb, setStorageGb] = useState(user.customQuota ? String(+(user.limitBytes / 1024 ** 3).toFixed(2)) : '')
  const [maxAudios, setMaxAudios] = useState(user.customQuota ? String(user.maxAudios) : '')

  const titles: Record<AdminAction, string> = {
    role: user.role === 'ADMIN' ? 'Retirar administrador' : 'Hacer administrador',
    status: suspended ? 'Reactivar cuenta' : 'Suspender cuenta',
    plan: 'Cambiar plan',
    quota: 'Cambiar cuota',
  }

  async function run(work: () => Promise<string>) {
    setBusy(true)
    setError('')
    try {
      onDone(await work())
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (action === 'role') {
      return void run(async () => {
        await changeUserRole(user.id, user.role === 'ADMIN' ? 'USER' : 'ADMIN', password)
        return user.role === 'ADMIN' ? 'Se retiró el rol de administrador.' : 'Ahora es administrador.'
      })
    }
    if (action === 'status') {
      return void run(async () => {
        await setUserStatus(user.id, suspended ? 'ACTIVE' : 'SUSPENDED', reason.trim() || undefined)
        return suspended ? 'Cuenta reactivada.' : 'Cuenta suspendida: se cerraron sus sesiones y apps.'
      })
    }
    if (action === 'plan') {
      const count = days.trim() ? Number(days) : undefined
      if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 3650)) return setError('Los días deben ser un número entero entre 1 y 3650')
      if (plan === 'TRIAL' && !count) return setError('La prueba gratuita necesita indicar los días')
      return void run(async () => {
        await setUserPlan(user.id, plan, count)
        return `Plan cambiado a ${PLAN_LABEL[plan]}.`
      })
    }
    const gb = storageGb.trim() ? Number(storageGb) : undefined
    const audios = maxAudios.trim() ? Number(maxAudios) : undefined
    if (gb === undefined && audios === undefined) return setError('Indica el almacenamiento, los audios o restablece la cuota')
    if (gb !== undefined && !(gb >= 0.01 && gb <= 100000)) return setError('El almacenamiento debe estar entre 0,01 y 100000 GB')
    if (audios !== undefined && (!Number.isInteger(audios) || audios < 1 || audios > 1_000_000)) return setError('Los audios deben ser un número entero mayor que 0')
    run(async () => {
      await setUserQuota(user.id, { ...(gb !== undefined ? { storageGb: gb } : {}), ...(audios !== undefined ? { maxAudios: audios } : {}) })
      return 'Cuota actualizada.'
    })
  }

  function resetQuota() {
    void run(async () => {
      await setUserQuota(user.id, { reset: true })
      return 'Cuota restablecida a la del plan.'
    })
  }

  const submitDisabled = busy || (action === 'role' && !password)

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="admin-user-dialog-title">
      <form onSubmit={submit}>
        <DialogTitle id="admin-user-dialog-title">{titles[action]}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText>
              <strong>{user.name}</strong>
              {user.email ? ` · ${user.email}` : ''}
            </DialogContentText>

            {action === 'role' && (
              <>
                <DialogContentText>Confirma el cambio de rol con la contraseña del propietario.</DialogContentText>
                <TextField label="Tu contraseña" type="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required fullWidth autoFocus />
              </>
            )}

            {action === 'status' && (
              <>
                <DialogContentText>
                  {suspended
                    ? 'Podrá volver a entrar. Si nunca verificó su correo, quedará pendiente de verificación.'
                    : 'No podrá entrar y se cerrarán sus sesiones web, sus apps vinculadas y sus códigos de aplicación. Su contenido no se borra.'}
                </DialogContentText>
                <TextField label="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)}
                  slotProps={{ htmlInput: { maxLength: 200 } }} helperText="Queda en el registro de acciones." fullWidth autoFocus />
              </>
            )}

            {action === 'plan' && (
              <>
                <TextField select label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as AdminPlan)} fullWidth>
                  {(Object.keys(PLAN_LABEL) as AdminPlan[]).map((value) => (
                    <MenuItem key={value} value={value}>{PLAN_LABEL[value]}</MenuItem>
                  ))}
                </TextField>
                <TextField label={plan === 'TRIAL' ? 'Días de prueba' : 'Días de vigencia (opcional)'} value={days}
                  onChange={(e) => setDays(e.target.value)} slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                  helperText={plan === 'TRIAL' ? 'Obligatorio en la prueba gratuita.' : 'Vacío = no vence.'} fullWidth />
                <Alert severity="info">Esto cambia el plan en BookBrief; no modifica una suscripción de Stripe.</Alert>
              </>
            )}

            {action === 'quota' && (
              <>
                <Typography variant="body2" color="text.secondary">
                  Ahora usa {formatBytes(user.usedBytes)} de {formatBytes(user.limitBytes)} y {user.audios} de {user.maxAudios} audios
                  {user.customQuota ? ' (cuota propia).' : ' (según su plan).'}
                </Typography>
                <TextField label="Almacenamiento (GB)" value={storageGb} onChange={(e) => setStorageGb(e.target.value)}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }} helperText="Vacío = no cambia." fullWidth autoFocus />
                <TextField label="Máximo de audios" value={maxAudios} onChange={(e) => setMaxAudios(e.target.value)}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }} helperText="Vacío = no cambia." fullWidth />
                {user.customQuota && (
                  <Button type="button" onClick={resetQuota} disabled={busy} sx={{ alignSelf: 'flex-start' }}>
                    Restablecer a la cuota del plan
                  </Button>
                )}
              </>
            )}

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant="contained" color={action === 'status' && !suspended ? 'error' : 'primary'} disabled={submitDisabled}>
            {action === 'status' ? (suspended ? 'Reactivar' : 'Suspender') : 'Confirmar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
