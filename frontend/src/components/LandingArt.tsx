import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

const TEAL = '#147D85'
const TEAL_LIGHT = '#E6F3F3'
const LINE = '#E4E7EC'

export type LandingIconName = 'upload' | 'folder' | 'play' | 'resume' | 'search' | 'image' | 'trash' | 'chart' | 'lock'

const ICONS: Record<LandingIconName, ReactNode> = {
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l6-3.5z" />
    </>
  ),
  resume: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4-4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
}

/** Icono lineal sobre un círculo suave; decorativo, por eso no se anuncia a los lectores de pantalla. */
export function LandingIcon({ name, size = 52 }: { name: LandingIconName; size?: number }) {
  return (
    <Box
      aria-hidden="true"
      sx={{ width: size, height: size, borderRadius: '50%', bgcolor: TEAL_LIGHT, display: 'grid', placeItems: 'center', flexShrink: 0 }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </svg>
    </Box>
  )
}

const examples = [
  { title: 'Ideas para crecer', author: 'Ejemplo de autor', color: '#147D85', category: 'Aprendizaje' },
  { title: 'Un nuevo comienzo', author: 'Ejemplo de autor', color: '#C77A5D', category: 'Bienestar' },
]

function ExampleCover({ title, color, small = false }: { title: string; color: string; small?: boolean }) {
  return (
    <Box
      sx={{
        width: small ? 58 : 78, height: small ? 74 : 100, flexShrink: 0, borderRadius: 1.5,
        bgcolor: color, color: '#fff', p: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}
    >
      <Typography sx={{ fontSize: small ? 9 : 11, fontWeight: 700, lineHeight: 1.2 }}>{title}</Typography>
      <Box sx={{ width: '50%', height: 3, borderRadius: 1, bgcolor: 'rgba(255,255,255,.55)' }} />
    </Box>
  )
}

function ExampleFrame({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ width: '100%', maxWidth: 480, mx: 'auto' }}>
      <Box aria-hidden="true" sx={{ bgcolor: '#fff', border: 1, borderColor: LINE, borderRadius: 3, overflow: 'hidden', boxShadow: '0 20px 55px rgba(23, 32, 51, .10)' }}>
        <Stack direction="row" sx={{ px: 2, py: 1, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: LINE }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: TEAL }}>● BookBrief</Typography>
          <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>Inicio　 Biblioteca　 Estadísticas</Typography>
        </Stack>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>{children}</Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
        Vista ilustrativa con datos de ejemplo
      </Typography>
    </Box>
  )
}

function ExampleAudio({ title, author, color, category, progress = false }: typeof examples[number] & { progress?: boolean }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ p: 1.5, border: 1, borderColor: LINE, borderRadius: 2, alignItems: 'flex-start' }}>
      <ExampleCover title={title} color={color} small />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{title}</Typography>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.3 }}>{author} · 24 min</Typography>
        <Typography sx={{ fontSize: 10, color: TEAL, mt: 0.5 }}>{category}　☆</Typography>
        {progress && (
          <>
            <Box sx={{ height: 4, bgcolor: LINE, borderRadius: 2, mt: 1 }}>
              <Box sx={{ width: '60%', height: '100%', bgcolor: TEAL, borderRadius: 2 }} />
            </Box>
            <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: 0.5 }}>Escuchado hasta 14:30 de 24:00</Typography>
          </>
        )}
      </Box>
    </Stack>
  )
}

export function HeroArt() {
  return (
    <ExampleFrame>
      <Typography sx={{ fontSize: 10, color: TEAL, fontWeight: 700, letterSpacing: '.08em' }}>TU ESPACIO DE ESCUCHA</Typography>
      <Typography sx={{ fontSize: 21, fontWeight: 800, mt: 0.5 }}>Inicio</Typography>
      <Typography sx={{ fontSize: 12, fontWeight: 700, mt: 2, mb: 1 }}>Continuar escuchando</Typography>
      <ExampleAudio {...examples[0]} progress />
      <Typography sx={{ fontSize: 12, fontWeight: 700, mt: 2, mb: 1 }}>Agregados recientemente</Typography>
      <ExampleAudio {...examples[1]} />
    </ExampleFrame>
  )
}

export function ProductExample({ type }: { type: 'upload' | 'library' | 'listen' }) {
  if (type === 'upload') {
    return (
      <ExampleFrame>
        <Typography sx={{ fontSize: 18, fontWeight: 800, mb: 2 }}>Agregar resumen</Typography>
        <Stack spacing={1.2}>
          {['Título · Ideas para crecer', 'Autor · Ejemplo de autor', 'Categoría · Aprendizaje', 'Archivo de audio · MP3 o M4A'].map((field) => (
            <Box key={field} sx={{ border: 1, borderColor: LINE, borderRadius: 1.5, px: 1.5, py: 1, fontSize: 12, color: 'text.secondary' }}>{field}</Box>
          ))}
          <Typography sx={{ fontSize: 11, color: TEAL }}>También puedes subir varios audios a la vez</Typography>
        </Stack>
      </ExampleFrame>
    )
  }

  if (type === 'library') {
    return (
      <ExampleFrame>
        <Typography sx={{ fontSize: 18, fontWeight: 800, mb: 1.5 }}>Mi biblioteca</Typography>
        <Box sx={{ border: 1, borderColor: LINE, borderRadius: 1.5, p: 1, fontSize: 11, color: 'text.secondary', mb: 1.5 }}>Buscar por título, autor o etiqueta</Box>
        <Typography sx={{ fontSize: 11, color: TEAL, mb: 1.5 }}>☆ Favoritos　 ·　 Categoría　 ·　 Etiqueta</Typography>
        <Stack spacing={1}>
          {examples.map((example) => <ExampleAudio key={example.title} {...example} />)}
        </Stack>
      </ExampleFrame>
    )
  }

  return (
    <ExampleFrame>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <ExampleCover title={examples[0].title} color={examples[0].color} />
        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 800 }}>{examples[0].title}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Ejemplo de autor · 24 min</Typography>
          <Typography sx={{ fontSize: 11, color: TEAL, mt: 1 }}>Retomando desde 14:30</Typography>
        </Box>
      </Stack>
      <Box sx={{ height: 5, bgcolor: LINE, borderRadius: 2, mt: 3 }}>
        <Box sx={{ width: '60%', height: '100%', bgcolor: TEAL, borderRadius: 2 }} />
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5, color: 'text.secondary', fontSize: 10 }}>
        <span>14:30</span><span>24:00</span>
      </Stack>
      <Typography sx={{ textAlign: 'center', color: TEAL, fontSize: 12, fontWeight: 700, mt: 2 }}>−15　　▶ Reproducir　　+15　　1×</Typography>
    </ExampleFrame>
  )
}
