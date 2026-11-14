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
const SAVE_EVERY_MS = 10_000

export interface SaveOptions {
  completed?: boolean
  /** Para guardados al cerrar la pestaña: la petición debe sobrevivir a la descarga de la página. */
  keepalive?: boolean
}

interface Props {
  src: string
  title: string
  artist: string
  /** Duración conocida por el servidor, se usa mientras el navegador carga los metadatos. */
  durationSeconds?: number | null
  /** Posición desde la que arrancar (progreso guardado). Solo se lee al montar el reproductor. */
  startAt?: number
  /** Guarda la posición: cada 10 s sonando, al pausar, saltar, terminar y al cerrar la pestaña. */
  onProgress?: (positionSeconds: number, options: SaveOptions) => void
  /** Se llama si el audio falla (por ejemplo, URL temporal caducada). */
  onError?: () => void
}

function loadRate(): number {
  const saved = Number(localStorage.getItem(RATE_KEY))
  return RATES.includes(saved) ? saved : 1
}

export default function AudioPlayer({ src, title, artist, durationSeconds, startAt = 0, onProgress, onError }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const resumeAt = useRef(startAt)
  const lastSaveAt = useRef(0)
  const dirty = useRef(false)
  // Última posición conocida: al desmontar, React ya soltó la referencia al <audio>.
  const position = useRef(startAt)
  // Destino del salto automático al retomar: no es un salto del usuario, no se guarda. Se compara
  // la posición (no una bandera) para no ignorar un salto real hecho mientras se aplica este.
  const resumeTarget = useRef<number | null>(null)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(startAt)
  const [duration, setDuration] = useState(durationSeconds ?? 0)
  const [seeking, setSeeking] = useState<number | null>(null)
  const [rate, setRate] = useState(loadRate)

  /** Guarda la posición actual solo si hubo avance desde el último guardado (o si se pide terminado). */
  const flush = (options: SaveOptions = {}) => {
    const save = onProgressRef.current
    if (!save || (!dirty.current && !options.completed)) return
    dirty.current = false
    lastSaveAt.current = Date.now()
    save(Math.floor(position.current), options)
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

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

  // Al ocultar o cerrar la pestaña y al salir de la pantalla se guarda con "keepalive".
  useEffect(() => {
    const save = () => flushRef.current({ keepalive: true })
    const onVisibility = () => document.visibilityState === 'hidden' && save()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', save)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [])

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
        onPause={(e) => {
          position.current = e.currentTarget.currentTime
          setPlaying(false)
          flush()
        }}
        onEnded={(e) => {
          position.current = e.currentTarget.currentTime
          setPlaying(false)
          dirty.current = true
          flush({ completed: true })
        }}
        onSeeked={(e) => {
          const reached = e.currentTarget.currentTime
          position.current = reached
          const target = resumeTarget.current
          resumeTarget.current = null
          if (target !== null && Math.abs(reached - target) < 0.75) return
          dirty.current = true
          flush()
        }}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget
          setCurrent(audio.currentTime)
          position.current = audio.currentTime
          if (audio.paused) return
          dirty.current = true
          if (Date.now() - lastSaveAt.current >= SAVE_EVERY_MS) flush()
        }}
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget
          if (Number.isFinite(audio.duration)) setDuration(audio.duration)
          audio.playbackRate = rate
          // Continúa donde iba: progreso guardado al abrir, o posición previa si la URL se renovó.
          if (resumeAt.current > 0 && (!Number.isFinite(audio.duration) || resumeAt.current < audio.duration - 1)) {
            resumeTarget.current = resumeAt.current
            audio.currentTime = resumeAt.current
            setCurrent(resumeAt.current)
          }
          resumeAt.current = 0
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
