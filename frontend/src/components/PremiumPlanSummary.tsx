import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { BillingPlan } from '../api'
import { PREMIUM_AUDIO_LIMIT, PREMIUM_PRICING, PREMIUM_STORAGE, PREMIUM_YEARLY_EQUIVALENT, PREMIUM_YEARLY_SAVINGS } from '../billing-plans'

export default function PremiumPlanSummary({
  plan,
  onPlanChange,
  stage = 'registration',
}: {
  plan: BillingPlan
  onPlanChange?: (plan: BillingPlan) => void
  stage?: 'registration' | 'verification' | 'login'
}) {
  const yearly = plan === 'yearly'

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
            TU PLAN SELECCIONADO
          </Typography>
          <Typography variant="h4" component="h2" sx={{ fontWeight: 800, letterSpacing: '-.03em' }}>
            Premium
          </Typography>
        </Box>

        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
            <Typography variant="h3" component="p" sx={{ fontWeight: 800, letterSpacing: '-.04em' }}>
              {PREMIUM_PRICING[plan].amount}
            </Typography>
            <Typography color="text.secondary">{PREMIUM_PRICING[plan].period}</Typography>
          </Stack>
          {yearly && (
            <Typography variant="body2" color="primary.dark" sx={{ fontWeight: 700, mt: 0.5 }}>
              Equivale a {PREMIUM_YEARLY_EQUIVALENT} · ahorras {PREMIUM_YEARLY_SAVINGS} al año
            </Typography>
          )}
        </Box>

        {onPlanChange && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              size="small"
              variant={yearly ? 'outlined' : 'contained'}
              onClick={() => onPlanChange('monthly')}
              aria-pressed={!yearly}
            >
              Mensual
            </Button>
            <Button
              size="small"
              variant={yearly ? 'contained' : 'outlined'}
              onClick={() => onPlanChange('yearly')}
              aria-pressed={yearly}
            >
              Anual · 2 meses gratis
            </Button>
          </Stack>
        )}

        <Stack spacing={1}>
          <Typography><strong>{PREMIUM_STORAGE}</strong> de almacenamiento</Typography>
          <Typography>Hasta <strong>{PREMIUM_AUDIO_LIMIT} audios propios</strong></Typography>
          <Typography>Organiza y retoma tu colección cuando quieras</Typography>
        </Stack>

        <Divider />

        <Stack spacing={1}>
          <Typography variant="body2">
            {stage === 'login'
              ? 'No se activa una prueba gratuita. Al iniciar sesión revisaremos tu cuenta y, si necesitas contratar Premium, continuarás al pago en Stripe.'
              : stage === 'verification'
                ? 'No se activa una prueba gratuita. Verifica tu correo y después inicia sesión para completar el pago en Stripe.'
                : 'No se activa una prueba gratuita. Primero verificas tu correo; después completas el pago en Stripe y se activa Premium.'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            La suscripción se renueva automáticamente. Puedes cancelarla desde tu cuenta y conservarás el acceso hasta terminar el período pagado.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Stripe procesa el pago; BookBrief no guarda los datos de tu tarjeta. Los precios están en pesos mexicanos e incluyen los impuestos aplicables; tu banco puede convertir el cargo si pagas desde otro país.
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  )
}
