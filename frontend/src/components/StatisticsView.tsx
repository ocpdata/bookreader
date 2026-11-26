import { useEffect, useState, type ReactNode } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { getAdminStatistics, getMyStatistics, getUserStatistics, type PersonalStatistics, type StatisticsPeriod } from '../api'
import { formatBytes, formatDuration } from '../format'
import AdminNav from './AdminNav'

const DAY_MS = 86_400_000
const PERIOD_DAYS: Record<StatisticsPeriod, number> = { today: 1, week: 7, month: 30 }
const GRID_SX = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 2 }
const CHART_HEIGHT = 140

/** Duración exacta, para detalles y tooltips. */
const duration = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 3600)} h ${Math.floor(seconds / 60) % 60} min ${seconds % 60} s`
}

/** Duración corta para tarjetas y listas; 0 se escribe "0 min". */
const brief = (ms: number) => formatDuration(ms / 1000) || '0 min'

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Todos los días del período (UTC, el último es hoy), con 0 donde no hubo escucha. */
function fillDays(days: PersonalStatistics['days'], period: StatisticsPeriod) {
  const byDate = new Map(days.map((day) => [day.date, day.durationMs]))
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: PERIOD_DAYS[period] }, (_, index) => {
    const date = new Date(today - (PERIOD_DAYS[period] - 1 - index) * DAY_MS).toISOString().slice(0, 10)
    return { date, durationMs: byDate.get(date) ?? 0 }
  })
}

function StatCard({ label, value, hint, accent = false }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, ...(accent && { bgcolor: 'primary.main', color: 'primary.contrastText', borderColor: 'primary.main' }) }}>
      <Typography variant="body2" sx={{ color: accent ? 'inherit' : 'text.secondary', opacity: accent ? 0.85 : 1 }}>{label}</Typography>
      <Typography variant="h5" component="p" sx={{ fontWeight: 800, mt: 0.5, overflowWrap: 'anywhere' }}>{value}</Typography>
      {hint && <Typography variant="caption" sx={{ color: accent ? 'inherit' : 'text.secondary', opacity: accent ? 0.85 : 1 }}>{hint}</Typography>}
    </Paper>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }} component="section">
      <Typography variant="h6" component="h2" sx={{ mb: 2 }}>{title}</Typography>
      {children}
    </Paper>
  )
}

function DailyChart({ days }: { days: { date: string; durationMs: number }[] }) {
  const max = Math.max(...days.map((day) => day.durationMs), 1)
  const middle = days[Math.floor(days.length / 2)]
  return (
    <Box>
      <Box
        role="img"
        aria-label={`Tiempo escuchado por día: ${days.filter((day) => day.durationMs > 0).map((day) => `${dayLabel(day.date)} ${brief(day.durationMs)}`).join(', ') || 'sin escucha'}`}
        sx={{ display: 'flex', alignItems: 'flex-end', gap: days.length > 14 ? '3px' : '8px', height: CHART_HEIGHT, borderBottom: 1, borderColor: 'divider' }}
      >
        {days.map((day) => (
          <Tooltip key={day.date} title={`${dayLabel(day.date)} · ${day.durationMs ? duration(day.durationMs) : 'sin escucha'}`} arrow>
            <Box sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <Box sx={{ width: '100%', height: Math.max(day.durationMs ? 6 : 2, (day.durationMs / max) * CHART_HEIGHT), borderRadius: '4px 4px 0 0', bgcolor: day.durationMs ? 'primary.main' : 'divider', transition: 'opacity .15s', '&:hover': { opacity: 0.75 } }} />
            </Box>
          </Tooltip>
        ))}
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.75, color: 'text.secondary' }}>
        <Typography variant="caption">{dayLabel(days[0].date)}</Typography>
        <Typography variant="caption">{dayLabel(middle.date)}</Typography>
        <Typography variant="caption">{dayLabel(days[days.length - 1].date)}</Typography>
      </Stack>
    </Box>
  )
}

function TopAudios({ titles, linkTitles }: { titles: PersonalStatistics['titles']; linkTitles: boolean }) {
  const top = titles.slice(0, 10)
  const max = Math.max(...top.map((title) => title.durationMs), 1)
  return (
    <Stack spacing={1.75} component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {top.map((title, index) => (
        <Box component="li" key={title.id}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Typography sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              <Box component="span" sx={{ color: 'text.secondary', mr: 1, fontVariantNumeric: 'tabular-nums' }}>{index + 1}.</Box>
              {linkTitles
                ? <Link component={RouterLink} to={`/audios/${title.id}`} color="inherit" underline="hover">{title.title}</Link>
                : title.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }} title={duration(title.durationMs)}>{brief(title.durationMs)}</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={(title.durationMs / max) * 100} sx={{ mt: 0.75, height: 6, borderRadius: 3, bgcolor: 'divider' }} />
        </Box>
      ))}
      {titles.length > top.length && <Typography variant="body2" color="text.secondary">y {titles.length - top.length} audios más</Typography>}
    </Stack>
  )
}

function PersonalDetails({ data, period, linkTitles }: { data: PersonalStatistics; period: StatisticsPeriod; linkTitles: boolean }) {
  const days = fillDays(data.days, period)
  const activeDays = data.days.filter((day) => day.durationMs > 0).length
  return (
    <Stack spacing={2.5}>
      <Box sx={GRID_SX}>
        <StatCard accent label="Tiempo escuchado" value={brief(data.durationMs)} hint={data.durationMs ? duration(data.durationMs) : undefined} />
        {period !== 'today' && <StatCard label="Días con escucha" value={`${activeDays} de ${PERIOD_DAYS[period]}`} />}
        <StatCard label="Audios escuchados" value={data.titles.length} />
      </Box>

      {period !== 'today' && (
        <Panel title="Por día">
          {data.days.length === 0 ? <Typography color="text.secondary">Sin escucha registrada en este período.</Typography> : <DailyChart days={days} />}
        </Panel>
      )}

      <Panel title="Más escuchados">
        {data.titles.length === 0 ? <Typography color="text.secondary">Sin escucha registrada en este período.</Typography> : <TopAudios titles={data.titles} linkTitles={linkTitles} />}
      </Panel>

      <Panel title={linkTitles ? 'Tu biblioteca' : 'Biblioteca'}>
        <Box sx={GRID_SX}>
          <StatCard label="Audios" value={data.saved} />
          <StatCard label="En progreso" value={data.inProgress} />
          <StatCard label="Terminados" value={data.finished} />
          <StatCard label="Favoritos" value={data.favorites} />
          <StatCard label="Almacenamiento" value={formatBytes(data.storageBytes)} hint={`${data.storageAudios} audios, con papelera y cargas pendientes`} />
        </Box>
      </Panel>
    </Stack>
  )
}

export default function StatisticsView({ admin = false }: { admin?: boolean }) {
  const { id } = useParams()
  const [period, setPeriod] = useState<StatisticsPeriod>('month')
  const [data, setData] = useState<PersonalStatistics | null>(null)
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getAdminStatistics>> | null>(null)
  const [person, setPerson] = useState<Awaited<ReturnType<typeof getUserStatistics>>['user'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setData(null)
    setOverview(null)
    setPerson(null)
    const load = async () => {
      if (admin && id) {
        const result = await getUserStatistics(id, period)
        if (active) { setPerson(result.user); setData(result.statistics) }
      } else if (admin) {
        const result = await getAdminStatistics(period)
        if (active) setOverview(result)
      } else {
        const result = await getMyStatistics(period)
        if (active) setData(result)
      }
    }
    load().catch((e: Error) => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [admin, id, period])

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 900 }}>
      {admin && (id
        ? <Button component={RouterLink} to="/administracion" sx={{ alignSelf: 'flex-start' }}>← Volver a usuarios</Button>
        : <AdminNav />)}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' } }}>
        <Box>
          <Typography variant="h5" component="h1">{admin ? 'Estadísticas de administración' : 'Mis estadísticas'}</Typography>
          <Typography variant="caption" color="text.secondary">Los días se cuentan en UTC.</Typography>
        </Box>
        <ToggleButtonGroup exclusive size="small" color="primary" value={period} aria-label="Período"
          onChange={(_, value: StatisticsPeriod | null) => { if (value) setPeriod(value) }}
          sx={{ bgcolor: 'background.paper' }}>
          <ToggleButton value="today">Hoy</ToggleButton>
          <ToggleButton value="week">7 días</ToggleButton>
          <ToggleButton value="month">30 días</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {person && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography sx={{ fontWeight: 700 }}>{person.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {person.email ?? 'Sin correo'} · Último inicio de sesión: {person.lastLoginAt ? new Date(person.lastLoginAt).toLocaleString('es') : 'nunca'}
          </Typography>
        </Paper>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <CircularProgress size={28} />}
      {overview && <>
        <Box sx={GRID_SX}>
          <StatCard label="Usuarios registrados" value={overview.registered} />
          <StatCard label="Con escucha en el período" value={overview.activeListeners} />
          <StatCard accent label="Tiempo de escucha web" value={brief(overview.durationMs)} hint={overview.durationMs ? duration(overview.durationMs) : undefined} />
        </Box>
        <Button component={RouterLink} to="/administracion" sx={{ alignSelf: 'flex-start' }}>Ver estadísticas por usuario</Button>
      </>}
      {data && <PersonalDetails data={data} period={period} linkTitles={!person} />}
      <Typography variant="caption" color="text.secondary">
        El historial comienza al activar esta función e incluye la escucha en la web y la que informan las apps compatibles
        (en línea y sin conexión). El tiempo es aproximado y puede perderse una parte si se cierra el navegador o falla la conexión.
      </Typography>
    </Stack>
  )
}
