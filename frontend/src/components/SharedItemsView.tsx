import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { listSharedItems, setFavorite } from '../api'
import type { Summary } from '../types'
import SummaryCard from './SummaryCard'

export default function SharedItemsView() {
  const [items, setItems] = useState<Summary[]>([])
  const [loadedRefresh, setLoadedRefresh] = useState(-1)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [pendingFavorites, setPendingFavorites] = useState<string[]>([])
  const loading = loadedRefresh !== refresh

  useEffect(() => {
    let active = true
    listSharedItems()
      .then((result) => { if (active) { setItems(result); setError('') } })
      .catch((e: Error) => { if (active) { setItems([]); setError(e.message) } })
      .finally(() => { if (active) setLoadedRefresh(refresh) })
    return () => { active = false }
  }, [refresh])

  async function toggleFavorite(summary: Summary) {
    if (pendingFavorites.includes(summary.id)) return
    setPendingFavorites((ids) => [...ids, summary.id])
    const favorite = !summary.favorite
    setItems((current) => current.map((item) => item.id === summary.id ? { ...item, favorite } : item))
    try {
      await setFavorite(summary.id, favorite)
    } catch (e) {
      setItems((current) => current.map((item) => item.id === summary.id ? { ...item, favorite: summary.favorite } : item))
      setError((e as Error).message)
    } finally {
      setPendingFavorites((ids) => ids.filter((id) => id !== summary.id))
    }
  }

  const visibleItems = items.filter((item) =>
    `${item.title} ${item.author} ${item.ownerName ?? ''}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, justifyContent: 'space-between' }}>
        <Typography variant="h5" component="h1">Audios compartidos conmigo</Typography>
        <Button component={RouterLink} to="/invitaciones" variant="contained">Ver y aceptar invitaciones</Button>
      </Stack>
      <Typography color="text.secondary">Audios de invitaciones aceptadas. Tus favoritos y tu progreso son personales.</Typography>
      <TextField label="Buscar por título, autor o propietario" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Button sx={{ alignSelf: 'flex-start' }} disabled={loading || pendingFavorites.length > 0} onClick={() => setRefresh((value) => value + 1)}>Actualizar compartidos</Button>
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <CircularProgress size={28} />}
      {!loading && !error && !items.length && (
        <Alert severity="info">
          ¿Llegaste desde un correo de invitación? Pulsa «Ver y aceptar invitaciones» y acepta la invitación recibida para ver los audios aquí.
        </Alert>
      )}
      {!loading && items.length > 0 && !visibleItems.length && <Typography>No hay audios que coincidan con la búsqueda.</Typography>}
      {!loading && visibleItems.map((item) => (
        <Stack key={item.id} spacing={0.5}>
          <Typography variant="body2" color="text.secondary">Propietario: {item.ownerName || 'No informado'}</Typography>
          <SummaryCard summary={item} onToggleFavorite={toggleFavorite} />
        </Stack>
      ))}
    </Stack>
  )
}
