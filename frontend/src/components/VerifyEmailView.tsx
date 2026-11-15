import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import { verifyEmail } from '../api'
import AuthCard from './AuthCard'

/** Destino del enlace del correo de verificación. Se canjea con un POST desde aquí: un escáner de enlaces no lo gasta. */
export default function VerifyEmailView() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<'working' | 'ok' | 'error'>(token ? 'working' : 'error')
  const [message, setMessage] = useState(token ? '' : 'El enlace no es válido.')
  // StrictMode ejecuta el efecto dos veces en desarrollo; el enlace es de un solo uso.
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    verifyEmail(token)
      .then((res) => {
        setMessage(res.message)
        setState('ok')
      })
      .catch((e: Error) => {
        setMessage(e.message)
        setState('error')
      })
  }, [token])

  return (
    <AuthCard title="Verificar correo">
      {state === 'working' && <CircularProgress size={28} />}
      {state === 'ok' && <Alert severity="success">{message}</Alert>}
      {state === 'error' && <Alert severity="error">{message}</Alert>}
      {state === 'ok' && (
        <Button component={RouterLink} to="/entrar" variant="contained">
          Iniciar sesión
        </Button>
      )}
      {state === 'error' && (
        <Button component={RouterLink} to="/registro" variant="outlined">
          Pedir otro enlace
        </Button>
      )}
    </AuthCard>
  )
}
