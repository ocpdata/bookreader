import { useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { changePassword } from '../api'
import { useAuth } from '../auth'

const MIN_LENGTH = 12

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
    <form onSubmit={handleSubmit}>
      <Stack spacing={2} sx={{ maxWidth: 420 }}>
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
  )
}
