import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { getResourceMetrics, type ResourceMetrics, type StatisticsPeriod } from '../api'
import { formatBytes } from '../format'

const sections = [
  { title: 'Servidor', metrics: [
    { id: 'cpu', label: 'CPU', unit: 'percent' },
    { id: 'memory', label: 'Memoria RAM', unit: 'percent' },
    { id: 'disk', label: 'Disco raíz utilizado', unit: 'percent' },
    { id: 'networkin', label: 'Red recibida', unit: 'bytes' },
    { id: 'networkout', label: 'Red enviada', unit: 'bytes' },
  ] },
  { title: 'Base de datos', metrics: [
    { id: 'dbcpu', label: 'CPU', unit: 'percent' },
    { id: 'dbfree', label: 'Espacio libre', unit: 'bytes' },
    { id: 'dbconnections', label: 'Conexiones', unit: 'number' },
  ] },
  { title: 'S3', metrics: [
    { id: 'storage', label: 'Almacenamiento estándar', unit: 'bytes' },
    { id: 'uploaded', label: 'Datos subidos', unit: 'bytes' },
    { id: 'downloaded', label: 'Datos descargados', unit: 'bytes' },
  ] },
] as const

const totals = new Set(['networkin', 'networkout', 'uploaded', 'downloaded'])
const dateTime = (value: string) => new Date(value).toLocaleString('es')
const format = (value: number, unit: 'percent' | 'bytes' | 'number') =>
  unit === 'bytes' ? formatBytes(value) : unit === 'percent' ? `${value.toFixed(1)} %` : value.toFixed(1)

function MetricCard({ label, unit, metric, total }: {
  label: string
  unit: 'percent' | 'bytes' | 'number'
  metric: ResourceMetrics['metrics'][string] | undefined
  total: boolean
}) {
  const points = metric?.points ?? []
  const max = Math.max(...points.map((point) => point.value), 1)
  const firstTime = points.length ? Date.parse(points[0].timestamp) : 0
  const span = points.length > 1 ? Date.parse(points[points.length - 1].timestamp) - firstTime : 0
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography variant="h5" sx={{ mt: 0.5 }}>
        {metric?.value == null ? 'Sin datos' : format(metric.value, unit)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {metric?.timestamp ? `${total ? 'Total del período' : 'Último intervalo'} · ${dateTime(metric.timestamp)}` : 'No disponible para este período'}
      </Typography>
      {points.length > 1 && (
        <Box component="svg" role="img" aria-label={`Evolución de ${label}, ${points.length} intervalos`} viewBox="0 0 1000 100" preserveAspectRatio="none" sx={{ width: '100%', height: 45, mt: 1 }}>
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
            points={points.map((point) => `${span ? (Date.parse(point.timestamp) - firstTime) * 1000 / span : 0},${100 - point.value / max * 100}`).join(' ')}
          />
        </Box>
      )}
    </Paper>
  )
}

export default function ResourcesView() {
  const [period, setPeriod] = useState<StatisticsPeriod>('week')
  const [data, setData] = useState<ResourceMetrics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getResourceMetrics(period).then((result) => {
      if (active) setData(result)
    }, (reason: Error) => {
      if (active) setError(reason.message)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [period])

  return (
    <Stack spacing={2.5}>
      <Button component={RouterLink} to="/administracion" sx={{ alignSelf: 'flex-start' }}>Volver a administración</Button>
      <Typography variant="h5" component="h1">Recursos del servidor</Typography>
      <ToggleButtonGroup exclusive size="small" value={period} onChange={(_, value: StatisticsPeriod | null) => {
        if (value && value !== period) {
          setData(null)
          setError('')
          setLoading(true)
          setPeriod(value)
        }
      }}>
        <ToggleButton value="today">Hoy</ToggleButton>
        <ToggleButton value="week">7 días</ToggleButton>
        <ToggleButton value="month">30 días</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="body2" color="text.secondary">
        Períodos en UTC. Los valores de CPU, RAM, disco y conexiones corresponden al último intervalo disponible; las transferencias son totales del período.
        S3 se actualiza diariamente para almacenamiento y sus transferencias son aproximadas. El tráfico de S3 y de la VM puede solaparse; no lo sumes ni lo uses como factura.
      </Typography>
      {loading && <CircularProgress size={28} />}
      {error && <Alert severity="error">{error}</Alert>}
      {data && (
        <>
          <Typography variant="body2" color="text.secondary">Consultado: {dateTime(data.generatedAt)} · Los datos recientes pueden tardar en aparecer.</Typography>
          {sections.map((section) => (
            <Box component="section" key={section.title}>
              <Typography variant="h6" component="h2" sx={{ mb: 1 }}>{section.title}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 2 }}>
                {section.metrics.map((metric) => <MetricCard key={metric.id} {...metric} metric={data.metrics[metric.id]} total={totals.has(metric.id)} />)}
              </Box>
            </Box>
          ))}
        </>
      )}
    </Stack>
  )
}
