import { useEffect, useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { changeUserRole, listAdminUsers, type AdminUser } from '../api'
import { useAuth } from '../auth'

const statusLabel = { ACTIVE: 'Activa', PENDING: 'Pendiente', SUSPENDED: 'Suspendida' }

export default function AdminUsersView() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<Awaited<ReturnType<typeof listAdminUsers>> | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<AdminUser | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')

  useEffect(() => {
    let active = true
    listAdminUsers(page).then((result) => {
      if (active) {
        setData(result)
        setError('')
      }
    }, (e: Error) => {
      if (active) {
        setData(null)
        setError(e.message)
      }
    })
    return () => { active = false }
  }, [page, refresh])

  function close() {
    if (busy) return
    setSelected(null)
    setPassword('')
    setDialogError('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setBusy(true)
    setDialogError('')
    try {
      const updated = await changeUserRole(selected.id, selected.role === 'ADMIN' ? 'USER' : 'ADMIN', password)
      setData((current) => current && {
        ...current,
        users: current.users.map((item) => item.id === updated.id ? { ...item, role: updated.role } : item),
      })
      setSelected(null)
      setPassword('')
      setRefresh((value) => value + 1)
    } catch (e) {
      setDialogError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 700 }}>
      <Typography variant="h5" component="h1">Administración de usuarios</Typography>
      <Typography color="text.secondary">
        Solo el propietario puede otorgar o retirar el rol de administrador.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {!data && !error && <CircularProgress size={28} />}
      {data?.users.map((item) => (
        <Stack key={item.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider', pb: 1 }}>
          <div>
            <Typography>{item.name}{item.isOwner ? ' · Propietario' : ''}</Typography>
            <Typography variant="body2" color="text.secondary">
              {item.email ?? 'Sin correo'} · {item.role === 'ADMIN' ? 'Administrador' : 'Usuario'} · {statusLabel[item.status]}
            </Typography>
          </div>
          {user?.isOwner && !item.isOwner && (
            <Button
              onClick={() => setSelected(item)}
              disabled={item.role === 'USER' && item.status !== 'ACTIVE'}
            >
              {item.role === 'ADMIN' ? 'Retirar administrador' : 'Hacer administrador'}
            </Button>
          )}
        </Stack>
      ))}
      {data && (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Button disabled={page === 1} onClick={() => { setData(null); setPage(page - 1) }}>Anterior</Button>
          <Typography variant="body2">Página {page} · {data.total} usuarios</Typography>
          <Button disabled={page * data.pageSize >= data.total} onClick={() => { setData(null); setPage(page + 1) }}>Siguiente</Button>
        </Stack>
      )}
      <Dialog open={selected !== null} onClose={close} fullWidth maxWidth="xs">
        <form onSubmit={submit}>
          <DialogTitle>{selected?.role === 'ADMIN' ? 'Retirar administrador' : 'Hacer administrador'}</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Confirma el cambio de rol para {selected?.name} con la contraseña del propietario.
            </DialogContentText>
            <TextField label="Tu contraseña" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required fullWidth autoFocus />
            {dialogError && <Alert severity="error" sx={{ mt: 2 }}>{dialogError}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button onClick={close} disabled={busy}>Cancelar</Button>
            <Button type="submit" variant="contained" disabled={busy || !password}>Confirmar</Button>
          </DialogActions>
        </form>
      </Dialog>
    </Stack>
  )
}
