import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { formatClock, formatDuration } from '../format'
import type { Summary } from '../types'
import CategoryChip from './CategoryChip'
import CoverImage from './CoverImage'
import ExpandableDescription from './ExpandableDescription'

interface Props {
  summary: Summary
  /** Versión reducida para la pantalla de inicio: sin narrador, etiquetas ni edición. */
  compact?: boolean
  grid?: boolean
  featured?: boolean
  activeTag?: string
  onToggleFavorite: (summary: Summary) => void
  onTagClick?: (tag: string) => void
  onDelete?: (summary: Summary) => void
  onMove?: (summary: Summary) => void
  /** Ruta de su carpeta, cuando la lista mezcla carpetas (búsqueda y filtros). */
  folderPath?: string
  onFolderClick?: (summary: Summary) => void
}

export default function SummaryCard({
  summary: s,
  compact = false,
  grid = false,
  featured = false,
  activeTag = '',
  onToggleFavorite,
  onTagClick,
  onDelete,
  onMove,
  folderPath,
  onFolderClick,
}: Props) {
  const navigate = useNavigate()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const meta = [s.author, formatDuration(s.durationSeconds)].filter(Boolean).join(' · ')
  const progress = s.progress
  const inProgress = !!progress && !progress.completed && progress.positionSeconds > 0
  const percent =
    inProgress && s.durationSeconds ? Math.min(100, (progress.positionSeconds / s.durationSeconds) * 100) : 0

  return (
    <Card variant="outlined" sx={{ display: 'flex', flexDirection: 'column', height: grid || compact ? '100%' : undefined }}>
      <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: grid ? 'column' : 'row', gap: 2, p: { xs: 2, sm: 2.5 } }}>
        <CoverImage src={s.coverUrl} title={s.title} seed={s.id} size={featured ? 112 : compact ? 72 : 88} large={grid} author={s.author} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontSize: featured ? '1.2rem' : '1rem', lineHeight: 1.35,
                overflowWrap: 'anywhere', ...(grid ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}) }}>
                {s.title}
              </Typography>
              {progress?.completed && <Chip label="Terminado" color="success" size="small" />}
            </Stack>
            <IconButton
              onClick={() => onToggleFavorite(s)}
              aria-label={`${s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}: ${s.title}`}
              aria-pressed={s.favorite}
              color={s.favorite ? 'primary' : 'default'}
              size="small"
              sx={{ ml: 0.5 }}
            >
              {s.favorite ? '★' : '☆'}
            </IconButton>
          </Stack>
          {!compact && s.summaryTitle && <Typography variant="subtitle2">{s.summaryTitle}</Typography>}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{meta}</Typography>
          {s.isOwner !== false && <Box sx={{ mt: 0.75 }}>
            <CategoryChip name={s.category.name} />
          </Box>}
          {s.description?.trim() && <ExpandableDescription description={s.description} title={s.title} />}
          {!compact && folderPath && (
            <Chip
              label={`📁 ${folderPath}`}
              size="small"
              variant="outlined"
              sx={{ mt: 0.5 }}
              onClick={onFolderClick ? () => onFolderClick(s) : undefined}
            />
          )}
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
              {s.durationSeconds && <LinearProgress variant="determinate" value={percent} aria-label={`Avance de ${s.title}`} sx={{ borderRadius: 2, height: 5 }} />}
              <Typography variant="caption" color="text.secondary">
                Escuchado hasta {formatClock(progress.positionSeconds)}{s.durationSeconds ? ` de ${formatClock(s.durationSeconds)}` : ''}
              </Typography>
            </Box>
          )}
        </Box>
      </CardContent>
      <CardActions sx={{ px: { xs: 2, sm: 2.5 }, pb: 2, pt: 0, justifyContent: 'space-between' }}>
        <Button variant={featured ? 'contained' : 'text'} onClick={() => navigate(`/audios/${s.id}`)}>
          {inProgress ? 'Continuar' : 'Escuchar'}
        </Button>
        {!compact && s.isOwner !== false && (
          <>
            <IconButton aria-label={`Opciones de ${s.title}`} aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)}
              onClick={(event) => setMenuAnchor(event.currentTarget)}>
              ⋯
            </IconButton>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              <MenuItem onClick={() => { setMenuAnchor(null); navigate(`/invitaciones?audio=${encodeURIComponent(s.id)}`) }}>Compartir</MenuItem>
              <MenuItem onClick={() => { setMenuAnchor(null); navigate(`/audios/${s.id}/editar`) }}>Editar</MenuItem>
              {onMove && <MenuItem onClick={() => { setMenuAnchor(null); onMove(s) }}>Mover</MenuItem>}
              {onDelete && <Divider />}
              {onDelete && <MenuItem sx={{ color: 'error.main' }} onClick={() => { setMenuAnchor(null); onDelete(s) }}>Eliminar</MenuItem>}
            </Menu>
          </>
        )}
      </CardActions>
    </Card>
  )
}
