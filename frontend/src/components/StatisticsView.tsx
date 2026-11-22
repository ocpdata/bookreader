import { useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { getAdminStatistics, getMyStatistics, getUserStatistics, type PersonalStatistics, type StatisticsPeriod } from '../api'
import { formatBytes } from '../format'

const duration = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 3600)} h ${Math.floor(seconds / 60) % 60} min ${seconds % 60} s`
}

function PersonalDetails({ data }: { data: PersonalStatistics }) {
  return (
    <>
      <Typography>Biblioteca actual: {data.saved} audios · {data.inProgress} en progreso · {data.finished} terminados · {data.favorites} favoritos</Typography>
      <Typography>Almacenamiento: {formatBytes(data.storageBytes)} en {data.storageAudios} audios, incluidos los de la papelera y las cargas pendientes.</Typography>
      <Typography variant="h6">Tiempo escuchado: {duration(data.durationMs)}</Typography>
      <Typography variant="h6">Por día (UTC)</Typography>
      {data.days.length === 0 ? <Typography color="text.secondary">Sin escucha registrada en este período.</Typography> :
        data.days.map((day) => <Typography key={day.date}>{day.date} · {duration(day.durationMs)}</Typography>)}
      <Typography variant="h6">Por audio</Typography>
      {data.titles.map((title) => <Typography key={title.id}>{title.title} · {duration(title.durationMs)}</Typography>)}
    </>
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
    <Stack spacing={2} sx={{ maxWidth: 700 }}>
      {admin && <Button component={RouterLink} to="/administracion" sx={{ alignSelf: 'flex-start' }}>← Administración de usuarios</Button>}
      <Typography variant="h5" component="h1">{admin ? 'Estadísticas de administración' : 'Mis estadísticas'}</Typography>
      {person && <Typography>{person.name} · {person.email ?? 'Sin correo'} · Último inicio de sesión: {person.lastLoginAt ? new Date(person.lastLoginAt).toLocaleString('es') : 'nunca'}</Typography>}
      <TextField select label="Período" value={period} onChange={(e) => setPeriod(e.target.value as StatisticsPeriod)} size="small" sx={{ maxWidth: 240 }}>
        <MenuItem value="today">Hoy (UTC)</MenuItem>
        <MenuItem value="week">Últimos 7 días (UTC)</MenuItem>
        <MenuItem value="month">Últimos 30 días (UTC)</MenuItem>
      </TextField>
      <Alert severity="info">
        El historial comienza al activar esta función y solo incluye escucha en la web. Las apps externas todavía no se contabilizan.
        El tiempo es aproximado y puede perderse una parte si se cierra el navegador o falla la conexión.
      </Alert>
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <CircularProgress size={28} />}
      {overview && <>
        <Typography>Usuarios registrados: {overview.registered}</Typography>
        <Typography>Usuarios con escucha registrada en el período: {overview.activeListeners}</Typography>
        <Typography>Tiempo de escucha web: {duration(overview.durationMs)}</Typography>
        <Button component={RouterLink} to="/administracion" sx={{ alignSelf: 'flex-start' }}>Ver estadísticas por usuario</Button>
      </>}
      {data && <PersonalDetails data={data} />}
    </Stack>
  )
}
