import { Link as RouterLink, useLocation } from 'react-router-dom'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'

const TABS = [
  { to: '/administracion', label: 'Usuarios' },
  { to: '/administracion/estadisticas', label: 'Estadísticas generales' },
  { to: '/administracion/recursos', label: 'Recursos del servidor' },
]

/** Pestañas del área de administración. En rutas de detalle (por ejemplo, las de un usuario) ninguna queda marcada. */
export default function AdminNav() {
  const { pathname } = useLocation()
  const current = TABS.find((tab) => tab.to === pathname)?.to ?? false
  return (
    <Tabs value={current} aria-label="Administración" variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider' }}>
      {TABS.map((tab) => (
        <Tab key={tab.to} value={tab.to} label={tab.label} component={RouterLink} to={tab.to} />
      ))}
    </Tabs>
  )
}
