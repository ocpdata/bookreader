import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { formatClock, formatDuration } from '../format'
import type { Summary } from '../types'

interface Props {
  summary: Summary
  /** Versión reducida para la pantalla de inicio: sin narrador, etiquetas ni edición. */
  compact?: boolean
  activeTag?: string
  onToggleFavorite: (summary: Summary) => void
  onTagClick?: (tag: string) => void
}

export default function SummaryCard({ summary: s, compact = false, activeTag = '', onToggleFavorite, onTagClick }: Props) {
  const navigate = useNavigate()
  const meta = [s.author, s.category.name, formatDuration(s.durationSeconds)].filter(Boolean).join(' · ')
  const progress = s.progress
  const inProgress = !!progress && !progress.completed && progress.positionSeconds > 0
  const percent =
    inProgress && s.durationSeconds ? Math.min(100, (progress.positionSeconds / s.durationSeconds) * 100) : 0

  return (
    <Card variant="outlined" sx={{ display: 'flex', flexDirection: 'column', height: compact ? '100%' : undefined }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h6">{s.title}</Typography>
            {progress?.completed && <Chip label="Terminado" color="success" size="small" />}
          </Stack>
          <IconButton
            onClick={() => onToggleFavorite(s)}
            aria-label={s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
            aria-pressed={s.favorite}
            color={s.favorite ? 'warning' : 'default'}
            size="small"
          >
            {s.favorite ? '★' : '☆'}
          </IconButton>
        </Stack>
        {!compact && s.summaryTitle && <Typography variant="subtitle2">{s.summaryTitle}</Typography>}
        <Typography color="text.secondary">{meta}</Typography>
        {!compact && s.narrator && (
          <Typography variant="body2" color="text.secondary">
            Narra: {s.narrator}
          </Typography>
        )}
        {!compact && s.tags.length > 0 && (
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
            {s.tags.map((name) => (
              <Chip
                key={name}
                label={name}
                size="small"
                variant={name.toLowerCase() === activeTag.toLowerCase() ? 'filled' : 'outlined'}
                onClick={onTagClick ? () => onTagClick(name) : undefined}
              />
            ))}
          </Stack>
        )}
        {inProgress && (
          <Box sx={{ mt: 1 }}>
            <LinearProgress variant="determinate" value={percent} aria-label="Avance" />
            <Typography variant="caption" color="text.secondary">
              Escuchado hasta {formatClock(progress.positionSeconds)}
            </Typography>
          </Box>
        )}
      </CardContent>
      <CardActions>
        <Button onClick={() => navigate(`/audios/${s.id}`)}>{inProgress ? 'Continuar' : 'Escuchar'}</Button>
        {!compact && <Button onClick={() => navigate(`/audios/${s.id}/editar`)}>Editar</Button>}
      </CardActions>
    </Card>
  )
}
