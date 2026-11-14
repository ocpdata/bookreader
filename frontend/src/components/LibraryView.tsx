import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { listSummaries } from '../api'
import type { Category, Summary } from '../types'

interface Props {
  categories: Category[]
  onListen: (summary: Summary) => void
  onEdit: (summary: Summary) => void
  onAdd: () => void
  refreshKey: number
}

export default function LibraryView({ categories, onListen, onEdit, onAdd, refreshKey }: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listSummaries(debouncedSearch, categoryId)
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
  }, [debouncedSearch, categoryId, refreshKey])

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="h1">
          Mi biblioteca
        </Typography>
        <Button variant="contained" onClick={onAdd}>
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
          onChange={(e) => setCategoryId(e.target.value)}
          size="small"
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">Todas</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
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

      {summaries.map((s) => (
        <Card key={s.id} variant="outlined">
          <CardContent>
            <Typography variant="h6">{s.title}</Typography>
            <Typography color="text.secondary">
              {s.author} · {s.category.name}
            </Typography>
          </CardContent>
          <CardActions>
            <Button onClick={() => onListen(s)}>Escuchar</Button>
            <Button onClick={() => onEdit(s)}>Editar</Button>
          </CardActions>
        </Card>
      ))}
    </Stack>
  )
}
