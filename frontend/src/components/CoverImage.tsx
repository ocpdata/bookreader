import Avatar from '@mui/material/Avatar'

// Colores suaves y estables por audio para el marcador cuando no hay portada.
const COLORS = ['#5c6bc0', '#26a69a', '#ef6c00', '#8e24aa', '#546e7a', '#c2185b', '#2e7d32', '#6d4c41']

const colorFor = (seed: string) => COLORS[[...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COLORS.length]

interface Props {
  /** URL de la portada; sin ella se muestra la inicial del título sobre un color. */
  src: string | null
  title: string
  seed: string
  size: number
}

export default function CoverImage({ src, title, seed, size }: Props) {
  return (
    <Avatar
      variant="rounded"
      src={src ?? undefined}
      alt={src ? `Portada de ${title}` : ''}
      slotProps={{ img: { loading: 'lazy' } }}
      sx={{ width: size, height: size, bgcolor: colorFor(seed), fontSize: size / 2.4, flexShrink: 0 }}
    >
      {title.trim().charAt(0).toUpperCase()}
    </Avatar>
  )
}
