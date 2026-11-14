import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { formatClock } from '../format'

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]
const RATE_KEY = 'bookreader.playbackRate'
const SKIP_SECONDS = 15

interface Props {
  src: string
  title: string
  artist: string
  /** Duración conocida por el servidor, se usa mientras el navegador carga los metadatos. */
  durationSeconds?: number | null
  /** Se llama si el audio falla (por ejemplo, URL temporal caducada). */
  onError?: () => void
}

function loadRate(): number {
  const saved = Number(localStorage.getItem(RATE_KEY))
  return RATES.includes(saved) ? saved : 1
}

export default function AudioPlayer({ src, title, artist, durationSeconds, onError }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const resumeAt = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(durationSeconds ?? 0)
  const [seeking, setSeeking] = useState<number | null>(null)
  const [rate, setRate] = useState(loadRate)

  const seekBy = (delta: number) => {
    const audio = audioRef.current
    if (!audio) return
    const max = Number.isFinite(audio.duration) ? audio.duration : Infinity
    audio.currentTime = Math.min(max, Math.max(0, audio.currentTime + delta))
  }

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => undefined)
    else audio.pause()
  }

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
    localStorage.setItem(RATE_KEY, String(rate))
  }, [rate])

  // Controles de la pantalla de bloqueo y de los auriculares.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    session.metadata = new MediaMetadata({ title, artist })
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void audioRef.current?.play()],
      ['pause', () => audioRef.current?.pause()],
      ['seekbackward', () => seekBy(-SKIP_SECONDS)],
      ['seekforward', () => seekBy(SKIP_SECONDS)],
      [
        'seekto',
        (details) => {
          if (audioRef.current && details.seekTime != null) audioRef.current.currentTime = details.seekTime
        },
      ],
    ]
    for (const [action, handler] of handlers) session.setActionHandler(action, handler)
    return () => {
      for (const [action] of handlers) session.setActionHandler(action, null)
    }
  }, [title, artist])

  const shown = seeking ?? current
  const total = duration || durationSeconds || 0

  return (
    <Stack spacing={1}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget
          if (Number.isFinite(audio.duration)) setDuration(audio.duration)
          audio.playbackRate = rate
          // Si la URL se renovó a mitad de la reproducción, continúa donde iba.
          if (resumeAt.current > 0) {
            audio.currentTime = resumeAt.current
            resumeAt.current = 0
          }
        }}
        onError={() => {
          resumeAt.current = audioRef.current?.currentTime ?? 0
          onError?.()
        }}
      />

      <Slider
        aria-label="Posición"
        min={0}
        max={Math.max(total, 1)}
        step={1}
        value={Math.min(shown, Math.max(total, 1))}
        onChange={(_, value) => setSeeking(value as number)}
        onChangeCommitted={(_, value) => {
          if (audioRef.current) audioRef.current.currentTime = value as number
          setSeeking(null)
        }}
      />
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          {formatClock(shown)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {total ? formatClock(total) : '--:--'}
        </Typography>
      </Stack>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" onClick={() => seekBy(-SKIP_SECONDS)} aria-label={`Retroceder ${SKIP_SECONDS} segundos`}>
          ⏪ {SKIP_SECONDS}
        </Button>
        <Button variant="contained" onClick={toggle} sx={{ minWidth: 110 }}>
          {playing ? '⏸ Pausa' : '▶ Reproducir'}
        </Button>
        <Button variant="outlined" onClick={() => seekBy(SKIP_SECONDS)} aria-label={`Adelantar ${SKIP_SECONDS} segundos`}>
          {SKIP_SECONDS} ⏩
        </Button>
        <TextField
          select
          size="small"
          label="Velocidad"
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          sx={{ minWidth: 110, ml: 'auto' }}
        >
          {RATES.map((r) => (
            <MenuItem key={r} value={r}>
              {r}×
            </MenuItem>
          ))}
        </TextField>
      </Box>
    </Stack>
  )
}
