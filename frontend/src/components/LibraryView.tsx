import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import Typography from '@mui/material/Typography'
import { listSummaries, listTags, setFavorite } from '../api'
import type { Category, SortOption, StatusFilter, Summary, TagSuggestion } from '../types'
import SummaryCard from './SummaryCard'

const SORTS: { value: SortOption; label: string }[] = [
  { value: 'recent', label: 'Más recientes' },
  { value: 'listened', label: 'Última escucha' },
  { value: 'title', label: 'Título (A–Z)' },
  { value: 'duration', label: 'Más largos' },
]

const STATUSES: { value: StatusFilter | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'unfinished', label: 'Pendientes' },
  { value: 'finished', label: 'Terminados' },
]

interface Props {
  categories: Category[]
}

export default function LibraryView({ categories }: Props) {
  const navigate = useNavigate()
  // Filtros y orden viven en la URL: el botón "atrás" vuelve a la misma búsqueda.
  const [params, setParams] = useSearchParams()
  const categoryId = params.get('categoria') ?? ''
  const tag = params.get('etiqueta') ?? ''
  const favorite = params.get('favoritos') === '1'
  const status = (STATUSES.some((s) => s.value === params.get('estado')) ? params.get('estado') : '') as StatusFilter | ''
  const sort = (SORTS.some((s) => s.value === params.get('orden')) ? params.get('orden') : 'recent') as SortOption

  const [search, setSearch] = useState(params.get('q') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(search.trim())
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [tags, setTags] = useState<TagSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const updateParams = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if ((params.get('q') ?? '') !== debouncedSearch) updateParams({ q: debouncedSearch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  useEffect(() => {
    listTags()
      .then(setTags)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listSummaries({ search: debouncedSearch, categoryId, tag, favorite, status, sort })
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
  }, [debouncedSearch, categoryId, tag, favorite, status, sort])

  async function toggleFavorite(summary: Summary) {
    const value = !summary.favorite
    // Actualización inmediata; si falla se revierte. Con el filtro de favoritos activo, sale de la lista.
    const apply = (favoriteValue: boolean) =>
      setSummaries((items) =>
        items
          .map((s) => (s.id === summary.id ? { ...s, favorite: favoriteValue } : s))
          .filter((s) => !(favorite && !s.favorite)),
      )
    apply(value)
    try {
      await setFavorite(summary.id, value)
    } catch (e) {
      setError((e as Error).message)
      setSummaries((items) => (items.some((s) => s.id === summary.id) ? items.map((s) => (s.id === summary.id ? { ...s, favorite: !value } : s)) : [...items, { ...summary, favorite: !value }]))
    }
  }

  const hasFilters = Boolean(debouncedSearch || categoryId || tag || favorite || status)

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

      <TextField
        label="Buscar por título, autor o etiqueta"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
        size="small"
      />
      <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleButton
          value="favoritos"
          size="small"
          selected={favorite}
          onChange={() => updateParams({ favoritos: favorite ? '' : '1' })}
          aria-label="Solo favoritos"
        >
          {favorite ? '★' : '☆'} Favoritos
        </ToggleButton>
        <TextField
          select
          label="Categoría"
          value={categoryId}
          onChange={(e) => updateParams({ categoria: e.target.value })}
          size="small"
          sx={{ minWidth: 170 }}
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
          label="Etiqueta"
          value={tag}
          onChange={(e) => updateParams({ etiqueta: e.target.value })}
          size="small"
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">Todas</MenuItem>
          {tag && !tags.some((t) => t.name.toLowerCase() === tag.toLowerCase()) && (
            <MenuItem value={tag}>{tag}</MenuItem>
          )}
          {tags.map((t) => (
            <MenuItem key={t.name} value={t.name}>
              {t.name} ({t.count})
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Estado"
          value={status}
          onChange={(e) => updateParams({ estado: e.target.value })}
          size="small"
          sx={{ minWidth: 140 }}
        >
          {STATUSES.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Ordenar por"
          value={sort}
          onChange={(e) => updateParams({ orden: e.target.value === 'recent' ? '' : e.target.value })}
          size="small"
          sx={{ minWidth: 160 }}
        >
          {SORTS.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        {hasFilters && (
          <Button
            size="small"
            onClick={() => {
              setSearch('')
              setParams(sort === 'recent' ? {} : { orden: sort }, { replace: true })
            }}
          >
            Limpiar filtros
          </Button>
        )}
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

      {summaries.map((s) => (
        <SummaryCard
          key={s.id}
          summary={s}
          activeTag={tag}
          onToggleFavorite={toggleFavorite}
          onTagClick={(name) => updateParams({ etiqueta: name })}
        />
      ))}
    </Stack>
  )
}
