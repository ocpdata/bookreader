import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { getHome, setFavorite } from '../api'
import type { HomeData, Summary } from '../types'
import SummaryCard from './SummaryCard'

const GRID_SX = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack spacing={1.5} component="section">
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      {children}
    </Stack>
  )
}

export default function HomeView() {
  const navigate = useNavigate()
  const [data, setData] = useState<HomeData | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = () =>
    getHome()
      .then((home) => {
        setData(home)
        setError('')
      })
      .catch((e: Error) => setError(e.message))

  useEffect(() => {
    void load()
  }, [])

  async function toggleFavorite(summary: Summary) {
    const value = !summary.favorite
    // Actualización inmediata en todas las secciones; si falla, se recarga el estado real.
    setData((current) => {
      if (!current) return current
      const mark = (list: Summary[]) => list.map((s) => (s.id === summary.id ? { ...s, favorite: value } : s))
      const favorites = value
        ? [{ ...summary, favorite: true }, ...current.favorites.filter((s) => s.id !== summary.id)]
        : current.favorites.filter((s) => s.id !== summary.id)
      return { ...current, continueListening: mark(current.continueListening), recent: mark(current.recent), favorites }
    })
    try {
      await setFavorite(summary.id, value)
    } catch (e) {
      setError((e as Error).message)
      void load()
    }
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    navigate(search.trim() ? `/biblioteca?q=${encodeURIComponent(search.trim())}` : '/biblioteca')
  }

  if (!data && !error) {
    return (
      <Box sx={{ textAlign: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    )
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="h1">
          Inicio
        </Typography>
        <Button variant="contained" onClick={() => navigate('/audios/nuevo')}>
          + Agregar resumen
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {data && data.total === 0 && (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography color="text.secondary">Aún no tienes resúmenes. Sube el primero para empezar a escuchar.</Typography>
          <Button variant="outlined" onClick={() => navigate('/audios/nuevo')}>
            Agregar mi primer resumen
          </Button>
        </Stack>
      )}

      {data && data.total > 0 && (
        <>
          <form onSubmit={submitSearch}>
            <TextField
              label="Buscar por título, autor o etiqueta"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              fullWidth
              size="small"
            />
          </form>

          {data.continueListening.length > 0 && (
            <Section title="Continuar escuchando">
              <Box sx={GRID_SX}>
                {data.continueListening.map((s) => (
                  <SummaryCard key={s.id} summary={s} compact onToggleFavorite={toggleFavorite} />
                ))}
              </Box>
            </Section>
          )}

          <Section title="Agregados recientemente">
            <Box sx={GRID_SX}>
              {data.recent.map((s) => (
                <SummaryCard key={s.id} summary={s} compact onToggleFavorite={toggleFavorite} />
              ))}
            </Box>
          </Section>

          {data.favorites.length > 0 && (
            <Section title="Favoritos">
              <Box sx={GRID_SX}>
                {data.favorites.map((s) => (
                  <SummaryCard key={s.id} summary={s} compact onToggleFavorite={toggleFavorite} />
                ))}
              </Box>
            </Section>
          )}

          <Section title="Explorar por categoría">
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
              {data.categories.map((c) => (
                <Chip
                  key={c.id}
                  label={`${c.name} (${c.count})`}
                  onClick={() => navigate(`/biblioteca?categoria=${c.id}`)}
                />
              ))}
            </Stack>
          </Section>

          <Button onClick={() => navigate('/biblioteca')} sx={{ alignSelf: 'flex-start' }}>
            Ver toda la biblioteca →
          </Button>
        </>
      )}
    </Stack>
  )
}
