import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { googleSignInUrl, type BillingPlan } from '../api'

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Cancelaste el acceso con Google.',
  google_unverified_email: 'Google no ha verificado ese correo, así que no podemos usarlo.',
  google_closed: 'No encontramos una cuenta con ese correo y el registro no está disponible por ahora.',
  google_suspended: 'Tu cuenta está suspendida.',
  google_too_many: 'Demasiados intentos. Inténtalo de nuevo en un rato.',
  google_unavailable: 'El acceso con Google no está disponible por ahora.',
}

/** Mensaje para el código `?error=` con el que el servidor devuelve un acceso fallido con Google. */
export const googleErrorMessage = (code: string | null) =>
  code?.startsWith('google_') ? GOOGLE_ERRORS[code] ?? 'No se pudo completar el acceso con Google. Inténtalo de nuevo.' : ''

function GoogleLogo() {
  return (
    <Box component="svg" viewBox="0 0 48 48" aria-hidden sx={{ width: 20, height: 20 }}>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </Box>
  )
}

/** Botón «Continuar con Google» con el aviso de que continuar acepta los términos, y el separador con el formulario. */
export default function GoogleSignIn({ source, plan }: { source?: 'share'; plan?: BillingPlan | null }) {
  return (
    <Stack spacing={1.5}>
      <Button
        component="a"
        href={googleSignInUrl({ source, plan })}
        variant="outlined"
        color="inherit"
        size="large"
        startIcon={<GoogleLogo />}
        sx={{ borderColor: 'divider', textTransform: 'none', fontWeight: 600 }}
      >
        Continuar con Google
      </Button>
      <Typography variant="caption" color="text.secondary">
        Al continuar con Google aceptas los{' '}
        <Link component={RouterLink} to="/terminos">términos de uso</Link> y el{' '}
        <Link component={RouterLink} to="/privacidad">aviso de privacidad</Link>.
      </Typography>
      <Divider>
        <Typography variant="caption" color="text.secondary">o con tu correo</Typography>
      </Divider>
    </Stack>
  )
}
