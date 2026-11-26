import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { getAuthConfig, getBillingConfig, type RegistrationMode } from '../api'
import { PREMIUM_AUDIO_LIMIT, PREMIUM_PRICING, PREMIUM_STORAGE } from '../billing-plans'
import { HeroArt, LandingIcon, ProductExample, type LandingIconName } from './LandingArt'

const STEPS: { type: 'upload' | 'library' | 'listen'; icon: LandingIconName; title: string; text: string }[] = [
  { type: 'upload', icon: 'upload', title: 'Sube tus audios', text: 'Agrega tus propios resúmenes en MP3 o M4A, uno por uno o varios a la vez. BookBrief te avisa si ya tienes uno igual.' },
  { type: 'library', icon: 'folder', title: 'Organízalos a tu manera', text: 'Encuentra cada audio con búsqueda, carpetas, categorías, etiquetas y favoritos.' },
  { type: 'listen', icon: 'play', title: 'Escucha y retoma', text: 'Reproduce desde el navegador, cambia la velocidad y continúa desde la posición guardada.' },
]

const FEATURES: { icon: LandingIconName; title: string; text: string }[] = [
  { icon: 'resume', title: 'Retoma sin perder el hilo', text: 'Cada audio guarda tu posición y puedes continuar desde la web o una app compatible.' },
  { icon: 'folder', title: 'Ordena a tu manera', text: 'Agrupa por carpetas y categorías, añade etiquetas y guarda tus favoritos.' },
  { icon: 'search', title: 'Encuentra lo que buscas', text: 'Busca por título, autor, descripción o etiqueta, incluso sin escribir acentos.' },
  { icon: 'chart', title: 'Cuida tu colección', text: 'Personaliza las portadas, revisa tus estadísticas y restaura audios desde la papelera.' },
]

const FAQ_BASE = [
  { q: '¿Qué formatos puedo subir?', a: 'MP3 y M4A, de hasta 200 MB por archivo.' },
  { q: '¿BookBrief incluye libros o resúmenes?', a: 'No. BookBrief organiza y reproduce los audios que tú subes; no incluye libros ni resúmenes. Sube únicamente contenido que tengas derecho a usar.' },
  { q: '¿Cuánto cuesta Premium?', a: `${PREMIUM_PRICING.monthly.amount} ${PREMIUM_PRICING.monthly.period} o ${PREMIUM_PRICING.yearly.amount} ${PREMIUM_PRICING.yearly.period}, con ${PREMIUM_STORAGE} y hasta ${PREMIUM_AUDIO_LIMIT} audios. Los precios están en pesos mexicanos e incluyen los impuestos aplicables.` },
  { q: '¿Qué pasa cuando termina la prueba?', a: 'Puedes seguir entrando, escuchando y descargando tus audios. Para subir nuevos necesitarás una suscripción.' },
  { q: '¿Qué pasa si elimino un audio?', a: 'Se mueve a la papelera, de donde puedes restaurarlo con todo su progreso. Solo se borra de forma definitiva al vaciar la papelera o cuando vence.' },
  { q: '¿Puedo eliminar mi cuenta?', a: 'Sí, cuando quieras y desde tu cuenta. Se borran tus archivos y todos tus datos.' },
]

const TRIAL_FAQ = {
  q: '¿Cómo funciona la prueba gratis?',
  a: 'Al verificar tu correo tienes 30 días de prueba, sin tarjeta, con 2 GB y hasta 25 audios. La prueba es una por correo.',
}

function Section({ title, subtitle, children, tinted = false, id }: { title: string; subtitle?: string; children: React.ReactNode; tinted?: boolean; id?: string }) {
  return (
    <Box component="section" id={id} sx={{ py: { xs: 6, md: 9 }, bgcolor: tinted ? 'background.paper' : 'transparent' }}>
      <Container maxWidth="lg">
        <Stack spacing={1.5} sx={{ textAlign: 'center', maxWidth: 640, mx: 'auto', mb: { xs: 4, md: 6 } }}>
          <Typography variant="h4" component="h2" sx={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
            {title}
          </Typography>
          {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
        </Stack>
        {children}
      </Container>
    </Box>
  )
}

/** Portada pública: se muestra en `/` cuando no hay sesión. */
export default function LandingView() {
  const [registration, setRegistration] = useState<RegistrationMode | 'error' | 'loading'>('loading')
  const [configAttempt, setConfigAttempt] = useState(0)
  const [billing, setBilling] = useState<'loading' | 'enabled' | 'disabled' | 'error'>('loading')
  const [billingAttempt, setBillingAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    getAuthConfig()
      .then((config) => { if (!cancelled) setRegistration(config.registration) })
      .catch(() => { if (!cancelled) setRegistration('error') })
    return () => { cancelled = true }
  }, [configAttempt])

  useEffect(() => {
    let cancelled = false
    getBillingConfig()
      .then(({ enabled }) => { if (!cancelled) setBilling(enabled ? 'enabled' : 'disabled') })
      .catch(() => { if (!cancelled) setBilling('error') })
    return () => { cancelled = true }
  }, [billingAttempt])

  const canRegister = registration === 'open' || registration === 'invite'
  const registrationLabel = registration === 'invite' ? 'Crear cuenta con invitación' : 'Prueba 30 días gratis'
  const faq = canRegister ? [TRIAL_FAQ, ...FAQ_BASE] : FAQ_BASE
  const premiumPath = (plan: 'monthly' | 'yearly') =>
    registration === 'closed' ? `/entrar?checkout=${plan}` : `/registro?plan=${plan}`
  const retryRegistration = () => {
    setRegistration('loading')
    setConfigAttempt((attempt) => attempt + 1)
  }
  const retryBilling = () => {
    setBilling('loading')
    setBillingAttempt((attempt) => attempt + 1)
  }

  const actions = (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
      {canRegister && (
        <Button component={RouterLink} to="/registro" variant="contained" size="large">
          {registrationLabel}
        </Button>
      )}
      <Button component={RouterLink} to="/entrar" variant={canRegister ? 'outlined' : 'contained'} size="large">
        Ya tengo cuenta
      </Button>
      <Button href="#como-funciona" size="large">Ver cómo funciona</Button>
    </Stack>
  )

  return (
    <Box>
      <Box component="section" sx={{ py: { xs: 5, md: 9 }, background: 'linear-gradient(180deg, #E6F3F3 0%, #F7F8FA 100%)' }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' }, gap: { xs: 4, md: 6 }, alignItems: 'center' }}>
            <Stack spacing={3}>
              <Typography variant="overline" sx={{ color: 'primary.dark', fontWeight: 700, letterSpacing: '0.12em' }}>
                TU BIBLIOTECA PERSONAL DE AUDIO
              </Typography>
              <Typography variant="h2" component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.04em', fontSize: { xs: '2.25rem', md: '3.25rem' }, lineHeight: 1.1 }}>
                Tus resúmenes en audio. Por fin, organizados y fáciles de retomar.
              </Typography>
              <Typography variant="h6" component="p" color="text.secondary" sx={{ fontWeight: 400, letterSpacing: 0, lineHeight: 1.5 }}>
                Guarda los audios que ya tienes, ordénalos por tema y continúa cada escucha justo donde la dejaste.
              </Typography>
              {registration === 'error' && (
                <Alert
                  severity="warning"
                  action={<Button color="inherit" size="small" onClick={retryRegistration}>Reintentar</Button>}
                >
                  No pudimos comprobar si el registro está disponible.
                </Alert>
              )}
              {registration === 'closed' && (
                <Alert severity="info">El registro está cerrado por ahora. Si ya tienes cuenta, puedes entrar.</Alert>
              )}
              {actions}
              {canRegister && (
                <Typography variant="body2" color="text.secondary">
                  30 días gratis · sin tarjeta · 2 GB y hasta 25 audios
                </Typography>
              )}
            </Stack>
            <HeroArt />
          </Box>
        </Container>
      </Box>

      <Section id="como-funciona" title="Así funciona BookBrief" subtitle="De tus archivos a una biblioteca lista para escuchar.">
        <Stack spacing={{ xs: 6, md: 8 }}>
          {STEPS.map((step, index) => (
            <Box key={step.title} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 3, md: 6 }, alignItems: 'center' }}>
              <Stack spacing={1.5} sx={{ order: { md: index % 2 ? 2 : 0 }, maxWidth: 430 }}>
                <LandingIcon name={step.icon} size={56} />
                <Typography variant="overline" sx={{ color: 'primary.dark', fontWeight: 700, letterSpacing: '.1em' }}>Paso {index + 1}</Typography>
                <Typography variant="h5" component="h3">{step.title}</Typography>
                <Typography color="text.secondary">{step.text}</Typography>
              </Stack>
              <Box sx={{ order: { md: index % 2 ? 1 : 0 } }}>
                <ProductExample type={step.type} />
              </Box>
            </Box>
          ))}
        </Stack>
      </Section>

      <Section id="funciones" tinted title="Todo lo que necesitas para volver a escuchar" subtitle="Menos tiempo buscando. Más tiempo aprendiendo a tu ritmo.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 3, maxWidth: 1000, mx: 'auto' }}>
          {FEATURES.map((feature) => (
            <Stack key={feature.title} direction="row" spacing={2} sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: 3, bgcolor: 'background.default' }}>
              <LandingIcon name={feature.icon} size={44} />
              <Stack spacing={0.5}>
                <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
                  {feature.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {feature.text}
                </Typography>
              </Stack>
            </Stack>
          ))}
        </Box>
      </Section>

      <Section id="precios" title="Empieza gratis. Sigue a tu ritmo." subtitle="Prueba BookBrief sin tarjeta y elige si quieres más espacio después.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: { xs: 2.5, md: 3 }, maxWidth: 960, mx: 'auto', textAlign: 'left', alignItems: 'stretch' }}>
          <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: { md: 470 },
            p: { xs: 3, md: 4 },
            border: 1,
            borderColor: 'divider',
            borderRadius: { xs: 4, md: 5 },
            background: 'linear-gradient(155deg, #FFFFFF 45%, #F3F8F9 100%)',
            boxShadow: '0 14px 36px rgba(28, 45, 70, .05)',
          }}>
            <Typography variant="overline" sx={{ color: 'primary.dark', fontWeight: 700, letterSpacing: '.1em' }}>PARA EMPEZAR</Typography>
            <Typography variant="h5" component="h3" sx={{ fontWeight: 800, mt: 1 }}>Prueba gratis</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mt: 2 }}>
              <Typography variant="h3" component="p" sx={{ fontWeight: 800, letterSpacing: '-.04em' }}>MX$0</Typography>
              <Typography color="text.secondary">por 30 días</Typography>
            </Stack>
            <Stack spacing={1.5} sx={{ my: 3 }}>
              <Typography><strong>2 GB</strong> de almacenamiento</Typography>
              <Typography>Hasta <strong>25 audios propios</strong></Typography>
              <Typography><strong>Sin tarjeta</strong>; una prueba por correo</Typography>
            </Stack>
            <Box sx={{ mt: 'auto' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Los 30 días empiezan al verificar tu correo.
              </Typography>
              {canRegister ? (
                <Button component={RouterLink} to="/registro" variant="outlined" size="large" fullWidth>
                  {registrationLabel}
                </Button>
              ) : registration === 'closed' ? (
                <Typography variant="body2" color="text.secondary">El registro está cerrado por ahora.</Typography>
              ) : registration === 'error' ? (
                <Button variant="outlined" size="large" fullWidth onClick={retryRegistration}>Comprobar disponibilidad</Button>
              ) : (
                <Button variant="outlined" size="large" fullWidth disabled>Comprobando disponibilidad…</Button>
              )}
            </Box>
          </Box>
          <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: { md: 470 },
            p: { xs: 3, md: 4 },
            border: 2,
            borderColor: 'primary.main',
            borderRadius: { xs: 4, md: 5 },
            background: 'linear-gradient(145deg, #E6F3F3 0%, #FFFFFF 72%)',
            boxShadow: '0 18px 42px rgba(20, 125, 133, .12)',
          }}>
            <Typography variant="overline" sx={{ color: 'primary.dark', fontWeight: 700, letterSpacing: '.1em' }}>PARA TU COLECCIÓN</Typography>
            <Typography variant="h5" component="h3" sx={{ fontWeight: 800, mt: 1 }}>Premium</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mt: 2 }}>
              <Typography variant="h3" component="p" sx={{ fontWeight: 800, letterSpacing: '-.04em' }}>{PREMIUM_PRICING.monthly.amount}</Typography>
              <Typography color="text.secondary">al mes</Typography>
            </Stack>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
              <Typography variant="body2" color="text.secondary">
                O {PREMIUM_PRICING.yearly.amount} {PREMIUM_PRICING.yearly.period}
              </Typography>
              <Box component="span" sx={{ px: 1, py: 0.35, borderRadius: 99, bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: '.75rem', fontWeight: 700 }}>
                2 meses gratis
              </Box>
            </Box>
            <Stack spacing={1.5} sx={{ my: 3 }}>
              <Typography><strong>{PREMIUM_STORAGE}</strong> de almacenamiento</Typography>
              <Typography>Hasta <strong>{PREMIUM_AUDIO_LIMIT} audios</strong></Typography>
              <Typography>Se renueva automáticamente; cancela desde tu cuenta</Typography>
            </Stack>
            <Box sx={{ mt: 'auto' }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {canRegister
                  ? 'Revisa los detalles del plan antes de crear tu cuenta. No se activa la prueba; el pago se completa después de verificar tu correo.'
                  : registration === 'closed'
                    ? 'Inicia sesión para revisar los detalles del plan y contratar Premium.'
                    : 'Revisa los detalles del plan antes de continuar con Premium.'}
              </Typography>
              {billing === 'enabled' ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button component={RouterLink} to={premiumPath('monthly')} variant="contained" size="large" fullWidth>
                    Contratar mensual
                  </Button>
                  <Button component={RouterLink} to={premiumPath('yearly')} variant="outlined" size="large" fullWidth>
                    Contratar anual
                  </Button>
                </Stack>
              ) : billing === 'disabled' ? (
                <Alert severity="info">La contratación de Premium no está disponible por ahora.</Alert>
              ) : billing === 'error' ? (
                <Button variant="outlined" size="large" fullWidth onClick={retryBilling}>Reintentar disponibilidad de pago</Button>
              ) : (
                <Button variant="outlined" size="large" fullWidth disabled>Comprobando disponibilidad de pago…</Button>
              )}
            </Box>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 3 }}>
          Precios en pesos mexicanos con impuestos aplicables incluidos. Al terminar la prueba no se inicia una suscripción automáticamente.
        </Typography>
      </Section>

      <Section title="Tu biblioteca es solo tuya">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ alignItems: { xs: 'center', sm: 'flex-start' }, maxWidth: 760, mx: 'auto' }}>
          <LandingIcon name="lock" size={64} />
          <Typography color="text.secondary" sx={{ textAlign: { xs: 'center', sm: 'left' } }}>
            Tus archivos viven en un almacenamiento privado y se reproducen con enlaces temporales que nadie más puede usar.
            Tus audios, tu progreso y tus estadísticas son de tu cuenta, y puedes eliminarla con todos tus datos cuando quieras.
          </Typography>
        </Stack>
      </Section>

      <Section tinted title="Escucha desde la web o tus apps compatibles" subtitle="Tu biblioteca te acompaña donde prefieras escuchar.">
        <Stack spacing={1.5} sx={{ maxWidth: 760, mx: 'auto', textAlign: 'center' }}>
          <Typography color="text.secondary">
            Escucha desde el navegador o conecta una app compatible con Audiobookshelf, como Absorb o AudioBooth,
            para sincronizar tu progreso cuando la integración esté habilitada.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Absorb y AudioBooth son aplicaciones de terceros.
          </Typography>
        </Stack>
      </Section>

      <Section tinted title="Preguntas frecuentes">
        <Stack spacing={1.5} sx={{ maxWidth: 760, mx: 'auto' }}>
          {faq.map((item) => (
            <Accordion key={item.q} disableGutters variant="outlined" sx={{ borderRadius: 3, '&::before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<Box aria-hidden="true" sx={{ fontSize: 22, lineHeight: 1 }}>+</Box>} sx={{ fontWeight: 650 }}>
                {item.q}
              </AccordionSummary>
              <AccordionDetails>
                <Typography color="text.secondary">{item.a}</Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </Stack>
      </Section>

      <Box component="section" sx={{ py: { xs: 6, md: 8 }, bgcolor: 'primary.dark', color: '#fff' }}>
        <Container maxWidth="md">
          <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Typography variant="h4" component="h2" sx={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
              Vuelve a tus audios justo donde los dejaste
            </Typography>
            {canRegister ? (
              <Button component={RouterLink} to="/registro" variant="contained" size="large" sx={{ bgcolor: '#fff', color: 'primary.dark', '&:hover': { bgcolor: '#E6F3F3' } }}>
                {registrationLabel}
              </Button>
            ) : registration === 'closed' ? (
              <>
                <Typography>El registro está cerrado por ahora. Si ya tienes cuenta, puedes entrar.</Typography>
                <Button component={RouterLink} to="/entrar" variant="contained" size="large" sx={{ bgcolor: '#fff', color: 'primary.dark', '&:hover': { bgcolor: '#E6F3F3' } }}>
                  Ya tengo cuenta
                </Button>
              </>
            ) : registration === 'error' ? (
              <>
                <Typography>No pudimos comprobar si el registro está disponible.</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button onClick={retryRegistration} variant="contained" size="large" sx={{ bgcolor: '#fff', color: 'primary.dark', '&:hover': { bgcolor: '#E6F3F3' } }}>
                    Reintentar
                  </Button>
                  <Button component={RouterLink} to="/entrar" variant="outlined" size="large" sx={{ borderColor: '#fff', color: '#fff' }}>
                    Ya tengo cuenta
                  </Button>
                </Stack>
              </>
            ) : (
              <Button variant="contained" size="large" disabled sx={{ bgcolor: '#fff', color: 'primary.dark' }}>
                Comprobando disponibilidad…
              </Button>
            )}
            {registration === 'loading' && (
              <Typography variant="body2">Estamos comprobando si puedes crear una cuenta.</Typography>
            )}
          </Stack>
        </Container>
      </Box>

      <Box component="footer" sx={{ py: 3 }}>
        <Container maxWidth="lg">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              © {new Date().getFullYear()} BookBrief
            </Typography>
            <Stack direction="row" spacing={2}>
              <Link component={RouterLink} to="/terminos" variant="body2" color="text.secondary">Términos</Link>
              <Link component={RouterLink} to="/privacidad" variant="body2" color="text.secondary">Privacidad</Link>
            </Stack>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 2 }}>
            Nota: Tú aportas los archivos; BookBrief no incluye audiolibros ni resúmenes.
          </Typography>
        </Container>
      </Box>
    </Box>
  )
}
