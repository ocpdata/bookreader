import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { getPlaybackUrl, getSummary } from '../api'
import type { Summary } from '../types'

interface Props {
  id: string
  onBack: () => void
  onEdit: (summary: Summary) => void
}

export default function SummaryDetail({ id, onBack, onEdit }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const refreshed = useRef(false)

  useEffect(() => {
    let cancelled = false
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

  // La URL temporal puede expirar si la ficha queda abierta mucho tiempo: se renueva una vez.
  async function handleAudioError() {
    if (refreshed.current) return setError('No se pudo reproducir el audio')
    refreshed.current = true
    try {
      setUrl(await getPlaybackUrl(id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Stack spacing={2}>
      <Button onClick={onBack} sx={{ alignSelf: 'flex-start' }}>
        ← Volver a la biblioteca
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
      {!summary && !error && <CircularProgress size={28} />}
      {summary && (
        <>
          <Typography variant="h5" component="h1">
            {summary.title}
          </Typography>
          <Typography color="text.secondary">
            {summary.author} · {summary.category.name}
          </Typography>
          {summary.description && <Typography>{summary.description}</Typography>}
          {url && <audio controls preload="metadata" src={url} onError={handleAudioError} style={{ width: '100%' }} />}
          <Button onClick={() => onEdit(summary)} sx={{ alignSelf: 'flex-start' }}>
            Editar
          </Button>
        </>
      )}
    </Stack>
  )
}
