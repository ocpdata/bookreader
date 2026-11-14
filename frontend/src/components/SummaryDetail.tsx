import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { getPlaybackUrl, getSummary } from '../api'
import { formatDuration } from '../format'
import type { Summary } from '../types'
import AudioPlayer from './AudioPlayer'

export default function SummaryDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const refreshed = useRef(false)

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

  const meta = summary
    ? [summary.author, summary.category.name, formatDuration(summary.durationSeconds)].filter(Boolean).join(' · ')
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
          <Typography variant="h5" component="h1">
            {summary.title}
          </Typography>
          {summary.summaryTitle && <Typography variant="subtitle1">{summary.summaryTitle}</Typography>}
          <Typography color="text.secondary">{meta}</Typography>
          {summary.narrator && (
            <Typography variant="body2" color="text.secondary">
              Narra: {summary.narrator}
            </Typography>
          )}
          {summary.description && <Typography>{summary.description}</Typography>}
          {url && (
            <AudioPlayer
              src={url}
              title={summary.title}
              artist={summary.author}
              durationSeconds={summary.durationSeconds}
              onError={handleAudioError}
            />
          )}
          <Button onClick={() => navigate(`/audios/${summary.id}/editar`)} sx={{ alignSelf: 'flex-start' }}>
            Editar
          </Button>
        </>
      )}
    </Stack>
  )
}
