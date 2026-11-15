import { useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import { useAuth } from '../auth'

/**
 * Bloquea la aplicación hasta aceptar la versión vigente de los términos y del aviso de privacidad (cuentas creadas
 * antes de que existieran o cuando cambian). Las páginas de los propios textos quedan libres para poder leerlos.
 */
export default function TermsGate() {
  const { user, acceptTerms, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reading = location.pathname === '/terminos' || location.pathname === '/privacidad'
  if (!user?.needsTerms || reading) return null

  async function accept() {
    setBusy(true)
    setError('')
    try {
      await acceptTerms()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function leave() {
    await logout()
    navigate('/entrar', { replace: true })
  }

  return (
    <Dialog open aria-labelledby="terms-title">
      <DialogTitle id="terms-title">Términos y aviso de privacidad</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Para seguir usando BookReader necesitas aceptar la versión vigente de los{' '}
          <Link component={RouterLink} to="/terminos">
            términos de uso
          </Link>{' '}
          y del{' '}
          <Link component={RouterLink} to="/privacidad">
            aviso de privacidad
          </Link>
          .
        </DialogContentText>
        <FormControlLabel control={<Checkbox checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />} label="He leído y acepto" />
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={leave} disabled={busy}>
          Salir
        </Button>
        <Button onClick={accept} variant="contained" disabled={!accepted || busy}>
          Aceptar y continuar
        </Button>
      </DialogActions>
    </Dialog>
  )
}
