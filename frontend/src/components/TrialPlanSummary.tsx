import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'

export default function TrialPlanSummary({
  stage = 'registration',
  shared = false,
}: {
  stage?: 'registration' | 'verification'
  shared?: boolean
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2.5, sm: 3 },
        borderColor: 'primary.main',
        borderRadius: 3,
        background: 'linear-gradient(145deg, #E6F3F3 0%, #FFFFFF 72%)',
        boxShadow: '0 16px 40px rgba(20, 125, 133, .10)',
      }}
    >
      <Stack spacing={2.25}>
        <Box>
          <Typography variant="overline" color="primary.dark" sx={{ fontWeight: 700, letterSpacing: '.1em' }}>
            EMPIEZA A TU RITMO
          </Typography>
          <Typography variant="h4" component="h2" sx={{ fontWeight: 800, letterSpacing: '-.03em' }}>
            30 días gratis
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="h3" component="p" sx={{ fontWeight: 800, letterSpacing: '-.04em' }}>
            MX$0
          </Typography>
          <Typography color="text.secondary">durante la prueba</Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography><strong>Sin tarjeta</strong> y sin cobro automático al terminar.</Typography>
          <Typography><strong>2 GB</strong> para tus audios.</Typography>
          <Typography>Hasta <strong>25 audios propios</strong>.</Typography>
          <Typography>Una prueba de 30 días por correo.</Typography>
          {shared && <Typography>Seguirás escuchando los audios compartidos mientras el propietario mantenga tu acceso.</Typography>}
        </Stack>

        <Divider />

        <Typography variant="body2">
          {stage === 'verification'
            ? 'Verifica tu correo para activar la cuenta. Si este correo no ha usado una prueba, los 30 días empiezan entonces.'
            : 'Los 30 días empiezan al verificar tu correo.'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Al terminar podrás seguir escuchando y descargando; para subir nuevos audios necesitarás Premium. La prueba no se convierte en una suscripción ni genera un cobro automático.
        </Typography>
        {stage === 'registration' && (
          <Link component={RouterLink} to="/#precios" variant="body2">
            ¿Necesitas más espacio? Conoce Premium
          </Link>
        )}
      </Stack>
    </Paper>
  )
}
