import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { getAuthConfig, type RegistrationMode } from '../api'
import { HeroArt, LandingIcon, ProductExample, type LandingIconName } from './LandingArt'

const STEPS: { type: 'upload' | 'library' | 'listen'; icon: LandingIconName; title: string; text: string }[] = [
  { type: 'upload', icon: 'upload', title: 'Sube tus audios', text: 'Agrega tus propios resúmenes en MP3 o M4A, uno por uno o varios a la vez. BookBrief te avisa si ya tienes uno igual.' },
  { type: 'library', icon: 'folder', title: 'Organízalos a tu manera', text: 'Encuentra cada audio con búsqueda, carpetas, categorías, etiquetas y favoritos.' },
  { type: 'listen', icon: 'play', title: 'Escucha y retoma', text: 'Reproduce desde el navegador, cambia la velocidad y continúa desde la posición guardada.' },
]

const FEATURES: { icon: LandingIconName; title: string; text: string }[] = [
  { icon: 'resume', title: 'Continúa donde lo dejaste', text: 'Cada audio recuerda tu posición y marca como terminado lo que ya escuchaste.' },
  { icon: 'folder', title: 'Biblioteca ordenada', text: 'Carpetas anidadas, categorías propias, hasta diez etiquetas por audio y favoritos a un clic.' },
  { icon: 'search', title: 'Búsqueda sin fricción', text: 'Encuentra por título, autor, resumen o etiqueta, sin importar acentos ni mayúsculas.' },
  { icon: 'image', title: 'Portadas', text: 'Toma la portada incrustada en tu archivo o sube la que prefieras.' },
  { icon: 'trash', title: 'Papelera con deshacer', text: '¿Borraste algo por error? Restáuralo con su progreso, etiquetas y carpeta intactos.' },
  { icon: 'chart', title: 'Tus estadísticas', text: 'Mira cuánto escuchas y cómo avanza tu hábito de aprendizaje.' },
]

const FAQ_BASE = [
  { q: '¿Qué formatos puedo subir?', a: 'MP3 y M4A, de hasta 200 MB por archivo.' },
  { q: '¿BookBrief incluye libros o resúmenes?', a: 'No. BookBrief es tu biblioteca personal: guarda y reproduce los audios que tú subes. Sube únicamente contenido que tengas derecho a usar.' },
  { q: '¿Cuánto espacio tengo?', a: 'La prueba incluye 2 GB y 25 audios; el plan Premium, 10 GB y 500 audios. Puedes ver tu uso en la sección Cuenta.' },
  { q: '¿Qué pasa si elimino un audio?', a: 'Se mueve a la papelera, de donde puedes restaurarlo con todo su progreso. Solo se borra de forma definitiva al vaciar la papelera o cuando vence.' },
  { q: '¿Puedo eliminar mi cuenta?', a: 'Sí, cuando quieras y desde tu cuenta. Se borran tus archivos y todos tus datos.' },
]

const TRIAL_FAQ = {
  q: '¿Cómo funciona la prueba gratis?',
  a: 'Al verificar tu correo tienes 30 días de prueba, sin tarjeta y con una prueba por correo. Al terminar puedes seguir escuchando tus audios; para subir nuevos necesitarás suscribirte.',
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
  const [registration, setRegistration] = useState<RegistrationMode>('closed')

  useEffect(() => {
    getAuthConfig()
      .then((config) => setRegistration(config.registration))
      .catch(() => undefined)
  }, [])

  const canRegister = registration !== 'closed'
  const faq = canRegister ? [TRIAL_FAQ, ...FAQ_BASE] : FAQ_BASE

  const actions = (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
      {canRegister && (
        <Button component={RouterLink} to="/registro" variant="contained" size="large">
          {registration === 'invite' ? 'Tengo una invitación' : 'Prueba gratis 30 días'}
        </Button>
      )}
      <Button component={RouterLink} to="/entrar" variant={canRegister ? 'outlined' : 'contained'} size="large">
        Entrar
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
                Tu biblioteca personal de audio
              </Typography>
              <Typography variant="h2" component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.04em', fontSize: { xs: '2.25rem', md: '3.25rem' }, lineHeight: 1.1 }}>
                Tus audios, organizados y listos para escuchar
              </Typography>
              <Typography variant="h6" component="p" color="text.secondary" sx={{ fontWeight: 400, letterSpacing: 0, lineHeight: 1.5 }}>
                Sube tus propios resúmenes, crea tu biblioteca privada y continúa donde te quedaste.
              </Typography>
              {actions}
              {canRegister && (
                <Typography variant="body2" color="text.secondary">
                  30 días de prueba, sin tarjeta.
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                BookBrief no incluye resúmenes: tú aportas los audios que tienes derecho a usar.
              </Typography>
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

      <Section tinted title="Todo para tu biblioteca de aprendizaje" subtitle="Herramientas sencillas que hacen que escuchar sea un hábito.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 3 }}>
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

      <Section title="Tu biblioteca es solo tuya">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ alignItems: { xs: 'center', sm: 'flex-start' }, maxWidth: 760, mx: 'auto' }}>
          <LandingIcon name="lock" size={64} />
          <Typography color="text.secondary" sx={{ textAlign: { xs: 'center', sm: 'left' } }}>
            Tus archivos viven en un almacenamiento privado y se reproducen con enlaces temporales que nadie más puede usar.
            Tus audios, tu progreso y tus estadísticas son de tu cuenta, y puedes eliminarla con todos tus datos cuando quieras.
          </Typography>
        </Stack>
      </Section>

      <Section tinted title="Escucha también en tu móvil" subtitle="Tu biblioteca te acompaña donde prefieras escuchar.">
        <Stack spacing={1.5} sx={{ maxWidth: 760, mx: 'auto', textAlign: 'center' }}>
          <Typography color="text.secondary">
            Escucha desde el navegador. Si la compatibilidad con Audiobookshelf está habilitada, también puedes
            conectar una app como Absorb o AudioBooth y sincronizar tu progreso con BookBrief.
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
              Convierte tus audios en una biblioteca que sí usas
            </Typography>
            {canRegister ? (
              <Button component={RouterLink} to="/registro" variant="contained" size="large" sx={{ bgcolor: '#fff', color: 'primary.dark', '&:hover': { bgcolor: '#E6F3F3' } }}>
                {registration === 'invite' ? 'Tengo una invitación' : 'Empieza tu prueba gratis'}
              </Button>
            ) : (
              <Button component={RouterLink} to="/entrar" variant="contained" size="large" sx={{ bgcolor: '#fff', color: 'primary.dark', '&:hover': { bgcolor: '#E6F3F3' } }}>
                Entrar
              </Button>
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
        </Container>
      </Box>
    </Box>
  )
}
