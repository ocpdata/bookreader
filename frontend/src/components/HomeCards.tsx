import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { formatClock, formatDuration } from '../format'
import type { Summary } from '../types'
import CategoryChip from './CategoryChip'
import CoverImage from './CoverImage'

interface Props {
  summary: Summary
  onToggleFavorite: (summary: Summary) => void
}

const COVER_RATIO = '4 / 5'

function listening(s: Summary) {
  const progress = s.progress
  const inProgress = !!progress && !progress.completed && progress.positionSeconds > 0
  const percent = inProgress && s.durationSeconds ? Math.min(100, (progress.positionSeconds / s.durationSeconds) * 100) : 0
  return { inProgress, percent, position: progress?.positionSeconds ?? 0 }
}

function FavoriteButton({ summary: s, onToggleFavorite, sx }: Props & { sx?: object }) {
  return (
    <IconButton
      onClick={() => onToggleFavorite(s)}
      aria-label={`${s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}: ${s.title}`}
      aria-pressed={s.favorite}
      color={s.favorite ? 'primary' : 'default'}
      size="small"
      sx={{ bgcolor: 'rgba(255,255,255,.92)', '&:hover': { bgcolor: '#fff' }, ...sx }}
    >
      {s.favorite ? '★' : '☆'}
    </IconButton>
  )
}

/** Tarjeta de estante: portada vertical protagonista y los datos justos debajo; toda la tarjeta abre el audio. */
export function ShelfCard({ summary: s, onToggleFavorite }: Props) {
  const navigate = useNavigate()
  const { inProgress, percent } = listening(s)
  return (
    <Card
      variant="outlined"
      sx={{
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        transition: 'transform .15s ease, box-shadow .15s ease',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 10px 28px rgba(23, 32, 51, 0.10)' },
      }}
    >
      <CardActionArea
        onClick={() => navigate(`/audios/${s.id}`)}
        aria-label={`${inProgress ? 'Continuar' : 'Escuchar'}: ${s.title}`}
        sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}
      >
        <Box sx={{ position: 'relative' }}>
          <CoverImage src={s.coverUrl} title={s.title} seed={s.id} size={120} large flat ratio={COVER_RATIO} author={s.author} />
          {s.progress?.completed && (
            <Chip label="Terminado" color="success" size="small" sx={{ position: 'absolute', left: 8, bottom: 8 }} />
          )}
          {inProgress && s.durationSeconds && (
            <LinearProgress
              variant="determinate"
              value={percent}
              aria-label={`Avance de ${s.title}`}
              sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, borderRadius: 0 }}
            />
          )}
        </Box>
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, width: '100%' }}>
          <Typography
            sx={{
              fontWeight: 700,
              lineHeight: 1.3,
              minHeight: '2.6em',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'anywhere',
            }}
          >
            {s.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.25 }}>
            {s.author}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }}>
            {[formatDuration(s.durationSeconds), s.isOwner !== false ? s.category.name : ''].filter(Boolean).join(' · ')}
          </Typography>
        </CardContent>
      </CardActionArea>
      <FavoriteButton summary={s} onToggleFavorite={onToggleFavorite} sx={{ position: 'absolute', top: 8, right: 8 }} />
    </Card>
  )
}

/** Destacado de «Continuar escuchando»: portada, avance, tiempo restante y un botón grande. */
export function ContinueCard({ summary: s, onToggleFavorite }: Props) {
  const navigate = useNavigate()
  const { inProgress, percent, position } = listening(s)
  const remaining = s.durationSeconds ? s.durationSeconds - position : 0
  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'relative',
        p: { xs: 2, sm: 3 },
        borderRadius: '16px',
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        gap: { xs: 2, sm: 3 },
        background: 'linear-gradient(145deg, #E6F3F3 0%, #FFFFFF 70%)',
        boxShadow: '0 12px 32px rgba(20, 125, 133, .10)',
      }}
    >
      <Box sx={{ width: { xs: 120, sm: 150 }, flexShrink: 0, alignSelf: 'flex-start', boxShadow: '0 8px 20px rgba(23, 32, 51, .18)', borderRadius: 1 }}>
        <CoverImage src={s.coverUrl} title={s.title} seed={s.id} size={120} large ratio={COVER_RATIO} author={s.author} />
      </Box>
      <Stack spacing={1.25} sx={{ minWidth: 0, flexGrow: 1, justifyContent: 'center', pr: { sm: 5 } }}>
        <Typography variant="overline" sx={{ color: 'primary.dark', fontWeight: 700, letterSpacing: '0.1em', lineHeight: 1.4 }}>
          Continúa donde lo dejaste
        </Typography>
        <Typography variant="h5" component="h3" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>
          {s.title}
        </Typography>
        <Typography color="text.secondary">{[s.author, formatDuration(s.durationSeconds)].filter(Boolean).join(' · ')}</Typography>
        {s.isOwner !== false && <CategoryChip name={s.category.name} />}
        {inProgress && (
          <Box>
            {s.durationSeconds && (
              <LinearProgress variant="determinate" value={percent} aria-label={`Avance de ${s.title}`} sx={{ height: 8, borderRadius: 4 }} />
            )}
            <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Escuchado hasta {formatClock(position)}{s.durationSeconds ? ` de ${formatClock(s.durationSeconds)}` : ''}
              </Typography>
              {remaining > 0 && <Typography variant="caption" color="text.secondary">Quedan {formatDuration(remaining)}</Typography>}
            </Stack>
          </Box>
        )}
        <Button variant="contained" size="large" onClick={() => navigate(`/audios/${s.id}`)} sx={{ alignSelf: 'flex-start', px: 4 }}>
          {inProgress ? 'Continuar' : 'Escuchar'}
        </Button>
      </Stack>
      <FavoriteButton summary={s} onToggleFavorite={onToggleFavorite} sx={{ position: 'absolute', top: 12, right: 12 }} />
    </Paper>
  )
}
