import { useEffect, useState, type MouseEvent, type KeyboardEvent } from 'react'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { getResourceMetrics, type ResourceMetrics, type StatisticsPeriod } from '../api'
import { formatBytes } from '../format'
import AdminNav from './AdminNav'

type Unit = 'percent' | 'bytes' | 'number'
type Metric = ResourceMetrics['metrics'][string]
type MetricDefinition = { id: string; label: string; unit: Unit; color: string; total?: boolean; daily?: boolean }

const serverMetrics: MetricDefinition[] = [
  { id: 'cpu', label: 'CPU', unit: 'percent', color: '#147D85' },
  { id: 'memory', label: 'Memoria RAM', unit: 'percent', color: '#5366B1' },
  { id: 'disk', label: 'Disco raíz utilizado', unit: 'percent', color: '#B87932' },
]
const networkMetrics: MetricDefinition[] = [
  { id: 'networkin', label: 'Red recibida', unit: 'bytes', color: '#147D85', total: true },
  { id: 'networkout', label: 'Red enviada', unit: 'bytes', color: '#5366B1', total: true },
]
const databaseMetrics: MetricDefinition[] = [
  { id: 'dbcpu', label: 'CPU', unit: 'percent', color: '#147D85' },
  { id: 'dbfree', label: 'Espacio libre', unit: 'bytes', color: '#5366B1' },
  { id: 'dbconnections', label: 'Conexiones', unit: 'number', color: '#B87932' },
]
const storageMetrics: MetricDefinition[] = [
  { id: 'storage', label: 'Almacenamiento estándar', unit: 'bytes', color: '#147D85', daily: true },
  { id: 'uploaded', label: 'Datos subidos', unit: 'bytes', color: '#5366B1', total: true },
  { id: 'downloaded', label: 'Datos descargados', unit: 'bytes', color: '#B87932', total: true },
]

const dateTime = (value: string) => `${new Date(value).toLocaleString('es', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
})} UTC`
const number = (value: number) => value.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const format = (value: number, unit: Unit) =>
  unit === 'bytes' ? formatBytes(value) : unit === 'percent' ? `${number(value)} %` : number(value)

function MetricChart({ metric, definition, period }: { metric: Metric; definition: MetricDefinition; period: StatisticsPeriod }) {
  const [selected, setSelected] = useState<number | null>(null)
  const points = metric.points
  const first = Date.parse(points[0].timestamp)
  const last = Date.parse(points[points.length - 1].timestamp)
  const span = last - first
  const maximum = Math.max(...points.map((point) => point.value), 0)
  const max = definition.unit === 'percent' ? Math.max(10, Math.ceil(maximum / 10) * 10) : Math.max(maximum, 1)
  const interval = definition.daily ? 86_400_000 : period === 'today' ? 300_000 : 3_600_000
  const x = (index: number) => span ? (Date.parse(points[index].timestamp) - first) * 1000 / span : 500
  const y = (index: number) => 92 - Math.min(points[index].value / max, 1) * 84
  const segments: number[][] = []
  points.forEach((point, index) => {
    if (index === 0 || Date.parse(point.timestamp) - Date.parse(points[index - 1].timestamp) > interval * 1.5) segments.push([])
    segments[segments.length - 1].push(index)
  })

  function selectFromPointer(event: MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const target = first + Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * span
    let nearest = 0
    for (let index = 1; index < points.length; index++) {
      if (Math.abs(Date.parse(points[index].timestamp) - target) < Math.abs(Date.parse(points[nearest].timestamp) - target)) nearest = index
    }
    setSelected(Math.abs(Date.parse(points[nearest].timestamp) - target) <= interval / 2 ? nearest : null)
  }

  function selectFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setSelected((current) => Math.max(0, Math.min(points.length - 1, (current ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))))
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', color: 'text.secondary', mb: 0.5 }}>
        <Typography variant="caption">Por intervalo</Typography>
        <Typography variant="caption">Escala: 0–{format(max, definition.unit)}</Typography>
      </Stack>
      <Box
        role="img"
        tabIndex={0}
        aria-label={`Gráfico de ${definition.label}. Usa las flechas para consultar los intervalos. ${selected === null ? '' : `${dateTime(points[selected].timestamp)}, ${format(points[selected].value, definition.unit)}`}`}
        onMouseMove={selectFromPointer}
        onMouseLeave={() => setSelected(null)}
        onFocus={() => setSelected(points.length - 1)}
        onBlur={() => setSelected(null)}
        onKeyDown={selectFromKeyboard}
        sx={{ position: 'relative', height: 66, borderBottom: 1, borderColor: 'divider', cursor: 'crosshair', outlineColor: definition.color }}
      >
        <Box component="svg" aria-hidden="true" viewBox="0 0 1000 100" preserveAspectRatio="none" sx={{ width: '100%', height: '100%', display: 'block' }}>
          <line x1="0" x2="1000" y1="50" y2="50" stroke="#E4E7EC" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          {segments.map((segment) => segment.length === 1
            ? <line key={segment[0]} x1={x(segment[0])} x2={x(segment[0])} y1={y(segment[0])} y2={y(segment[0])} stroke={definition.color} strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            : <polyline key={segment[0]} fill="none" stroke={definition.color} strokeWidth="2" vectorEffect="non-scaling-stroke" points={segment.map((index) => `${x(index)},${y(index)}`).join(' ')} />)}
          {selected !== null && <line x1={x(selected)} x2={x(selected)} y1="0" y2="100" stroke={definition.color} opacity="0.45" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        </Box>
        {selected !== null && (
          <Box sx={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', px: 1, py: 0.4, borderRadius: 1, bgcolor: 'text.primary', color: 'white', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 1 }}>
            <Typography variant="caption">{dateTime(points[selected].timestamp)} · {format(points[selected].value, definition.unit)}</Typography>
          </Box>
        )}
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', color: 'text.secondary', mt: 0.5, gap: 1 }}>
        <Typography variant="caption">{dateTime(points[0].timestamp)}</Typography>
        <Typography variant="caption" sx={{ textAlign: 'right' }}>{dateTime(points[points.length - 1].timestamp)}</Typography>
      </Stack>
    </Box>
  )
}

function MetricCard({ definition, metric, period }: { definition: MetricDefinition; metric: Metric | undefined; period: StatisticsPeriod }) {
  const value = metric?.value
  const hasData = value != null
  return (
    <Paper variant="outlined" sx={{ p: 2.25, minWidth: 0, borderRadius: 3, height: '100%', boxShadow: '0 4px 20px rgba(23, 32, 51, 0.035)' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box aria-hidden="true" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: definition.color, flexShrink: 0 }} />
        <Typography variant="body2" sx={{ fontWeight: 650, color: 'text.secondary' }}>{definition.label}</Typography>
      </Stack>
      <Typography variant="h4" component="p" sx={{ mt: 1.25, fontWeight: 750, letterSpacing: '-0.04em', fontSize: hasData ? '1.9rem' : '1.3rem' }}>
        {value != null ? format(value, definition.unit) : 'Sin datos'}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {hasData && metric?.timestamp
          ? `${definition.total ? 'Total del período' : definition.daily ? 'Último dato diario' : 'Último intervalo'} · ${dateTime(metric.timestamp)}`
          : 'Esperando datos para este período'}
      </Typography>
      {metric && metric.points.length > 1 && <MetricChart metric={metric} definition={definition} period={period} />}
      {metric && metric.points.length === 1 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>Solo hay una muestra disponible.</Typography>}
    </Paper>
  )
}

function MetricSection({ title, description, definitions, data, period }: {
  title: string
  description: string
  definitions: MetricDefinition[]
  data: ResourceMetrics
  period: StatisticsPeriod
}) {
  return (
    <Box component="section">
      <Stack spacing={0.25} sx={{ mb: 1.5 }}>
        <Typography variant="h6" component="h2">{title}</Typography>
        <Typography variant="body2" color="text.secondary">{description}</Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: `repeat(${definitions.length}, minmax(0, 1fr))` }, gap: 2 }}>
        {definitions.map((definition) => <MetricCard key={definition.id} definition={definition} metric={data.metrics[definition.id]} period={period} />)}
      </Box>
    </Box>
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
    <Stack spacing={3.5}>
      <AdminNav />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' } }}>
        <Box>
          <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 750, letterSpacing: '0.1em' }}>MONITOREO · AWS</Typography>
          <Typography variant="h5" component="h1">Recursos del servidor</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>Uso y transferencias de tu infraestructura.</Typography>
        </Box>
        <ToggleButtonGroup exclusive size="small" aria-label="Período" value={period} onChange={(_, value: StatisticsPeriod | null) => {
          if (value && value !== period) {
            setData(null)
            setError('')
            setLoading(true)
            setPeriod(value)
          }
        }} sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' }, bgcolor: 'background.paper' }}>
          <ToggleButton value="today">Hoy</ToggleButton>
          <ToggleButton value="week">7 días</ToggleButton>
          <ToggleButton value="month">30 días</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Accordion disableGutters variant="outlined" sx={{ borderRadius: '12px !important', '&::before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<Box aria-hidden="true" sx={{ fontSize: 20 }}>+</Box>}>
          <Typography variant="body2" sx={{ fontWeight: 650 }}>Cómo interpretar estos datos</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary">
            Períodos y fechas en UTC. Uso, espacio y conexiones muestran el promedio del último intervalo disponible;
            las transferencias son totales del período. Los gráficos muestran valores por intervalo y no unen períodos sin datos.
            El almacenamiento S3 se actualiza diariamente y sus transferencias son aproximadas.
            El tráfico de S3 y de la VM puede solaparse: no lo sumes ni lo uses como factura.
          </Typography>
        </AccordionDetails>
      </Accordion>
      {loading && <CircularProgress size={28} />}
      {error && <Alert severity="error">{error}</Alert>}
      {data && (
        <>
          <Typography variant="body2" color="text.secondary">Actualizado: {dateTime(data.generatedAt)} · Los datos recientes pueden tardar en aparecer.</Typography>
          <MetricSection title="Servidor" description="Uso de la máquina virtual" definitions={serverMetrics} data={data} period={period} />
          <MetricSection title="Transferencia de red" description="Datos recibidos y enviados por la máquina virtual" definitions={networkMetrics} data={data} period={period} />
          <MetricSection title="Base de datos" description="Uso y conexiones de RDS" definitions={databaseMetrics} data={data} period={period} />
          <MetricSection title="Almacenamiento S3" description="Espacio y transferencia del bucket" definitions={storageMetrics} data={data} period={period} />
        </>
      )}
    </Stack>
  )
}
