import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { deleteSummary, getPlaybackUrl, getSummary, resetProgress, saveProgress, setFavorite } from '../api'
import { formatClock, formatDuration } from '../format'
import type { Progress, Summary } from '../types'
import AudioPlayer, { type SaveOptions } from './AudioPlayer'
import CategoryChip from './CategoryChip'
import ConfirmDialog from './ConfirmDialog'
import CoverImage from './CoverImage'

export default function SummaryDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [startAt, setStartAt] = useState(0)
  const [playerKey, setPlayerKey] = useState(0)
  const [favorite, setFavoriteState] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const refreshed = useRef(false)
  // Durante "Reiniciar" se ignoran los guardados del reproductor que se desmonta.
  const suppressSave = useRef(false)

  useEffect(() => {
    let cancelled = false
    refreshed.current = false
    setSummary(null)
    setUrl('')
    setError('')
    Promise.all([getSummary(id), getPlaybackUrl(id)])
      .then(([s, u]) => {
        if (cancelled) return
        setSummary(s)
        setUrl(u)
        setProgress(s.progress)
        setFavoriteState(s.favorite)
        // Un audio terminado vuelve a empezar desde el principio.
        setStartAt(s.progress && !s.progress.completed ? s.progress.positionSeconds : 0)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [id])

  // La URL temporal caduca (1 h): se renueva una vez y el reproductor continúa donde iba.
  async function handleAudioError() {
    if (refreshed.current) return setError('No se pudo reproducir el audio')
    refreshed.current = true
    try {
      setUrl(await getPlaybackUrl(id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Un fallo al guardar no interrumpe la escucha: el siguiente guardado lo reintenta.
  const handleProgress = (positionSeconds: number, options: SaveOptions) => {
    if (suppressSave.current) return
    saveProgress(id, { positionSeconds, ...(options.completed ? { completed: true } : {}) }, options.keepalive)
      .then(setProgress)
      .catch(() => undefined)
  }

  async function setCompleted(completed: boolean) {
    try {
      setProgress(await saveProgress(id, { completed }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function toggleFavorite() {
    const value = !favorite
    setFavoriteState(value)
    try {
      await setFavorite(id, value)
    } catch (e) {
      setFavoriteState(!value)
      setError((e as Error).message)
    }
  }

  async function moveToTrash() {
    if (!summary) return
    setDeleting(true)
    // El reproductor se desmonta al salir y guarda su posición: se ignora para no recrear progreso.
    suppressSave.current = true
    try {
      await deleteSummary(id)
      navigate('/biblioteca', { replace: true, state: { trashed: { id, title: summary.title } } })
    } catch (e) {
      suppressSave.current = false
      setError((e as Error).message)
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  async function restart() {
    suppressSave.current = true
    try {
      await resetProgress(id)
      setProgress(null)
      setStartAt(0)
      setPlayerKey((k) => k + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      // El reproductor anterior guarda al desmontarse; después ya se puede guardar de nuevo.
      setTimeout(() => (suppressSave.current = false), 500)
    }
  }

  const meta = summary
    ? [summary.author, formatDuration(summary.durationSeconds)].filter(Boolean).join(' · ')
    : ''

  return (
    <Stack spacing={2}>
      <Button onClick={() => navigate(-1)} sx={{ alignSelf: 'flex-start' }}>
        ← Volver
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
      {!summary && !error && <CircularProgress size={28} />}
      {summary && (
        <>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            <CoverImage src={summary.coverUrl} title={summary.title} seed={summary.id} size={120} />
            <Stack spacing={0.5} sx={{ minWidth: 0 }}>
              <Typography variant="h5" component="h1">
                {summary.title}
              </Typography>
              {summary.summaryTitle && <Typography variant="subtitle1">{summary.summaryTitle}</Typography>}
              <Typography color="text.secondary">{meta}</Typography>
              <CategoryChip name={summary.category.name} />
              {summary.narrator && (
                <Typography variant="body2" color="text.secondary">
                  Narra: {summary.narrator}
                </Typography>
              )}
            </Stack>
          </Stack>
          {summary.description && <Typography>{summary.description}</Typography>}

          {summary.tags.length > 0 && (
            <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
              {summary.tags.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(`/biblioteca?etiqueta=${encodeURIComponent(name)}`)}
                />
              ))}
            </Stack>
          )}

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {progress?.completed && <Chip label="Terminado" color="success" size="small" />}
            {startAt > 0 && (
              <Typography variant="body2" color="text.secondary">
                Retomando desde {formatClock(startAt)}
              </Typography>
            )}
          </Stack>

          {url && (
            <AudioPlayer
              key={playerKey}
              src={url}
              title={summary.title}
              artist={summary.author}
              artwork={summary.coverUrl}
              durationSeconds={summary.durationSeconds}
              startAt={startAt}
              onProgress={handleProgress}
              onError={handleAudioError}
            />
          )}

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button onClick={toggleFavorite} aria-pressed={favorite} color={favorite ? 'warning' : 'primary'}>
              {favorite ? '★ Favorito' : '☆ Añadir a favoritos'}
            </Button>
            <Button onClick={() => setCompleted(!progress?.completed)}>
              {progress?.completed ? 'Marcar como pendiente' : 'Marcar como terminado'}
            </Button>
            <Button onClick={restart} disabled={!progress}>
              Reiniciar
            </Button>
            <Button onClick={() => navigate(`/audios/${summary.id}/editar`)}>Editar</Button>
            <Button color="error" onClick={() => setConfirmingDelete(true)} sx={{ ml: 'auto' }}>
              Eliminar
            </Button>
          </Stack>
          <ConfirmDialog
            open={confirmingDelete}
            title="¿Mover a la papelera?"
            message={`«${summary.title}» se moverá a la papelera. Podrás restaurarlo durante 30 días.`}
            confirmLabel="Mover a la papelera"
            destructive
            busy={deleting}
            onConfirm={moveToTrash}
            onCancel={() => setConfirmingDelete(false)}
          />
        </>
      )}
    </Stack>
  )
}
