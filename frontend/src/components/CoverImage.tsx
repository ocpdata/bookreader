import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

// Colores suaves y estables por audio para el marcador cuando no hay portada.
const COLORS = ['#385D66', '#597064', '#685B76', '#78675C', '#435875', '#795860']

const colorFor = (seed: string) => COLORS[[...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COLORS.length]

interface Props {
  /** URL de la portada; sin ella se muestra la inicial del título sobre un color. */
  src: string | null
  title: string
  seed: string
  size: number
  /** Portada cuadrada que ocupa el ancho de una tarjeta. */
  large?: boolean
  author?: string
}

export default function CoverImage({ src, title, seed, size, large = false, author }: Props) {
  const initials = author?.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('')
  return (
    <Avatar
      variant="rounded"
      src={src ?? undefined}
      alt={src ? `Portada de ${title}` : ''}
      slotProps={{ img: { loading: 'lazy' } }}
      sx={{ width: large ? '100%' : size, height: large ? 'auto' : size, aspectRatio: large ? '1 / 1' : undefined,
        bgcolor: colorFor(seed), fontSize: size / 2.4, flexShrink: 0 }}
    >
      {large ? (
        <Box sx={{ width: '100%', height: '100%', p: 2.5, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', textAlign: 'left', color: '#fff' }}>
          <Typography sx={{ fontSize: 11, letterSpacing: '0.12em', fontWeight: 700 }}>BOOKBRIEF</Typography>
          <Box>
            <Typography sx={{ fontSize: 'clamp(1rem, 2vw, 1.35rem)', fontWeight: 700, lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
              {title}
            </Typography>
            {initials && <Typography sx={{ mt: 1, fontSize: 12, letterSpacing: '0.08em' }}>{initials}</Typography>}
          </Box>
        </Box>
      ) : title.trim().charAt(0).toUpperCase()}
    </Avatar>
  )
}
