import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { listSummaries } from '../api'
import { formatClock, formatDuration } from '../format'
import type { Category, SortOption, Summary } from '../types'

const SORTS: { value: SortOption; label: string }[] = [
  { value: 'recent', label: 'Más recientes' },
  { value: 'title', label: 'Título (A–Z)' },
  { value: 'duration', label: 'Más largos' },
]

interface Props {
  categories: Category[]
}

export default function LibraryView({ categories }: Props) {
  const navigate = useNavigate()
  // Filtros y orden viven en la URL: el botón "atrás" vuelve a la misma búsqueda.
  const [params, setParams] = useSearchParams()
  const categoryId = params.get('categoria') ?? ''
  const sort = (SORTS.some((s) => s.value === params.get('orden')) ? params.get('orden') : 'recent') as SortOption

  const [search, setSearch] = useState(params.get('q') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(search.trim())
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if ((params.get('q') ?? '') !== debouncedSearch) updateParam('q', debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listSummaries(debouncedSearch, categoryId, sort)
      .then((items) => {
        if (cancelled) return
        setSummaries(items)
        setError('')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [debouncedSearch, categoryId, sort])

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="h1">
          Mi biblioteca
        </Typography>
        <Button variant="contained" onClick={() => navigate('/audios/nuevo')}>
          + Agregar resumen
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Buscar por título o autor"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          fullWidth
          size="small"
        />
        <TextField
          select
          label="Categoría"
          value={categoryId}
          onChange={(e) => updateParam('categoria', e.target.value)}
          size="small"
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">Todas</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Ordenar por"
          value={sort}
          onChange={(e) => updateParam('orden', e.target.value === 'recent' ? '' : e.target.value)}
          size="small"
          sx={{ minWidth: 170 }}
        >
          {SORTS.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {loading && (
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      )}
      {!loading && !error && summaries.length === 0 && (
        <Typography color="text.secondary">No hay resúmenes que mostrar.</Typography>
      )}

      {summaries.map((s) => {
        const meta = [s.author, s.category.name, formatDuration(s.durationSeconds)].filter(Boolean).join(' · ')
        const progress = s.progress
        const inProgress = !!progress && !progress.completed && progress.positionSeconds > 0
        const percent =
          inProgress && s.durationSeconds ? Math.min(100, (progress.positionSeconds / s.durationSeconds) * 100) : 0
        return (
          <Card key={s.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="h6">{s.title}</Typography>
                {progress?.completed && <Chip label="Terminado" color="success" size="small" />}
              </Stack>
              {s.summaryTitle && <Typography variant="subtitle2">{s.summaryTitle}</Typography>}
              <Typography color="text.secondary">{meta}</Typography>
              {s.narrator && (
                <Typography variant="body2" color="text.secondary">
                  Narra: {s.narrator}
                </Typography>
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
              <Button onClick={() => navigate(`/audios/${s.id}/editar`)}>Editar</Button>
            </CardActions>
          </Card>
        )
      })}
    </Stack>
  )
}
