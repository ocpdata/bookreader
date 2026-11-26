import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { listAdminUsers, type AdminPlan, type AdminRole, type AdminStatus, type AdminUser, type AdminUsersPage, type AdminUsersQuery } from '../api'
import { useAuth } from '../auth'
import { formatBytes, formatDate } from '../format'
import AdminNav from './AdminNav'
import AdminUserDialog, { PLAN_LABEL, type AdminAction } from './AdminUserDialog'

const STATUS_LABEL: Record<AdminStatus, string> = { ACTIVE: 'Activa', PENDING: 'Pendiente', SUSPENDED: 'Suspendida' }
const STATUS_COLOR: Record<AdminStatus, 'success' | 'warning' | 'error'> = { ACTIVE: 'success', PENDING: 'warning', SUSPENDED: 'error' }
const ROLE_LABEL: Record<AdminRole, string> = { ADMIN: 'Administrador', USER: 'Usuario' }
const PAGE_SIZES = [25, 50, 100]
const SORTS = ['created', 'lastLogin', 'name'] as const
type Sort = (typeof SORTS)[number]

const PLAN_SHORT: Record<AdminPlan, string> = { NONE: 'Sin plan', TRIAL: 'Prueba', PREMIUM: 'Premium', FOUNDER: 'Fundador' }

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined => (allowed.includes(value as T) ? (value as T) : undefined)

function StatCard({ label, value, active, onClick }: { label: string; value: number | string; active?: boolean; onClick?: () => void }) {
  return (
    <Paper
      variant="outlined"
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      aria-pressed={onClick ? Boolean(active) : undefined}
      sx={{
        p: 2, borderRadius: '14px', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: onClick ? 'pointer' : 'default',
        bgcolor: active ? 'action.selected' : 'background.paper', borderColor: active ? 'primary.main' : 'divider',
        '&:hover': onClick ? { borderColor: 'primary.main' } : undefined,
      }}
    >
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h5" component="p" sx={{ fontWeight: 800 }}>{value}</Typography>
    </Paper>
  )
}

function UsageCell({ user }: { user: AdminUser }) {
  const percent = Math.min(100, (user.usedBytes / user.limitBytes) * 100)
  const full = percent >= 90 || user.audios >= user.maxAudios
  return (
    <Box sx={{ minWidth: 150 }}>
      <LinearProgress variant="determinate" value={percent} color={full ? 'warning' : 'primary'} aria-label={`Almacenamiento de ${user.name}`} sx={{ height: 6, borderRadius: 3 }} />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, whiteSpace: 'nowrap' }}>
        {formatBytes(user.usedBytes)} de {formatBytes(user.limitBytes)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap' }}>
        {user.audios} de {user.maxAudios} audios{user.customQuota ? ' · cuota propia' : ''}
      </Typography>
    </Box>
  )
}

export default function AdminUsersView() {
  const { user: me } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const query = useMemo<AdminUsersQuery>(() => {
    const pageSize = Number(params.get('tam'))
    return {
      page: Math.max(1, Number(params.get('pagina')) || 1),
      pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 50,
      q: params.get('q')?.trim() || undefined,
      role: pick(params.get('rol'), ['USER', 'ADMIN'] as const),
      status: pick(params.get('estado'), ['ACTIVE', 'PENDING', 'SUSPENDED'] as const),
      plan: pick(params.get('plan'), ['NONE', 'TRIAL', 'PREMIUM', 'FOUNDER'] as const),
      sort: pick(params.get('orden'), SORTS) ?? 'created',
      order: params.get('dir') === 'asc' ? 'asc' : 'desc',
    }
  }, [params])

  const [data, setData] = useState<AdminUsersPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState(query.q ?? '')
  const [menu, setMenu] = useState<{ anchor: HTMLElement; user: AdminUser } | null>(null)
  const [dialog, setDialog] = useState<{ user: AdminUser; action: AdminAction } | null>(null)

  function update(changes: Record<string, string | undefined>, resetPage = true) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (resetPage) next.delete('pagina')
    setParams(next, { replace: true })
  }

  // La búsqueda se aplica al dejar de escribir.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((query.q ?? '') !== search.trim()) update({ q: search.trim() || undefined })
    }, 350)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    let active = true
    setLoading(true)
    listAdminUsers(query).then(
      (result) => {
        if (!active) return
        setData(result)
        setError('')
        setLoading(false)
      },
      (e: Error) => {
        if (!active) return
        setError(e.message)
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [query, refresh])

  const summary = data?.summary
  const totalUsers = summary ? Object.values(summary.byStatus).reduce((sum, count) => sum + (count ?? 0), 0) : 0
  const isOwner = Boolean(me?.isOwner)

  function sortBy(field: Sort) {
    const sameField = query.sort === field
    update({ orden: field, dir: sameField ? (query.order === 'asc' ? 'desc' : 'asc') : field === 'name' ? 'asc' : 'desc' })
  }

  const sortCell = (field: Sort, label: string) => (
    <TableSortLabel active={query.sort === field} direction={query.sort === field ? query.order : 'asc'} onClick={() => sortBy(field)}>
      {label}
    </TableSortLabel>
  )

  /** Reglas que también aplica el servidor: así los botones no ofrecen lo que se va a rechazar. */
  function cannotSuspend(item: AdminUser) {
    if (item.status === 'SUSPENDED') return false
    return item.isOwner || item.id === me?.id || (item.role === 'ADMIN' && !isOwner)
  }

  const filtersActive = Boolean(query.q || query.role || query.status || query.plan)

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 1280, mx: 'auto' }}>
      <Typography variant="h5" component="h1">Administración</Typography>
      <AdminNav />

      {summary && (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' } }}>
          <StatCard label="Usuarios" value={totalUsers} active={!query.status} onClick={() => update({ estado: undefined })} />
          {(['ACTIVE', 'PENDING', 'SUSPENDED'] as const).map((status) => (
            <StatCard key={status} label={`${STATUS_LABEL[status]}s`} value={summary.byStatus[status] ?? 0}
              active={query.status === status} onClick={() => update({ estado: status })} />
          ))}
          <StatCard label="Administradores" value={summary.byRole.ADMIN ?? 0} active={query.role === 'ADMIN'}
            onClick={() => update({ rol: query.role === 'ADMIN' ? undefined : 'ADMIN' })} />
        </Box>
      )}

      <Paper variant="outlined" sx={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(23, 32, 51, 0.035)' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2, alignItems: { md: 'center' } }}>
          <TextField size="small" label="Buscar por nombre o correo" value={search} onChange={(e) => setSearch(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 100 } }} sx={{ flexGrow: 1, minWidth: 220 }} />
          <TextField select size="small" label="Rol" value={query.role ?? ''} onChange={(e) => update({ rol: e.target.value || undefined })} sx={{ minWidth: 150 }}>
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="USER">Usuario</MenuItem>
            <MenuItem value="ADMIN">Administrador</MenuItem>
          </TextField>
          <TextField select size="small" label="Estado" value={query.status ?? ''} onChange={(e) => update({ estado: e.target.value || undefined })} sx={{ minWidth: 150 }}>
            <MenuItem value="">Todos</MenuItem>
            {(Object.keys(STATUS_LABEL) as AdminStatus[]).map((value) => <MenuItem key={value} value={value}>{STATUS_LABEL[value]}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Plan" value={query.plan ?? ''} onChange={(e) => update({ plan: e.target.value || undefined })} sx={{ minWidth: 170 }}>
            <MenuItem value="">Todos</MenuItem>
            {(Object.keys(PLAN_LABEL) as AdminPlan[]).map((value) => <MenuItem key={value} value={value}>{PLAN_LABEL[value]}</MenuItem>)}
          </TextField>
          {filtersActive && (
            <Button onClick={() => { setSearch(''); update({ q: undefined, rol: undefined, estado: undefined, plan: undefined }) }}>Limpiar</Button>
          )}
        </Stack>
        {loading && <LinearProgress aria-label="Cargando usuarios" />}
        {error && <Alert severity="error" sx={{ mx: 2, mb: 2 }}>{error}</Alert>}
        {notice && <Alert severity="success" role="status" onClose={() => setNotice('')} sx={{ mx: 2, mb: 2 }}>{notice}</Alert>}

        <TableContainer sx={{ maxHeight: '70vh', opacity: loading && data ? 0.6 : 1, transition: 'opacity .15s' }}>
          <Table stickyHeader size="medium" sx={{ minWidth: 1000, '& th, & td': { px: 1.5 }, '& th': { whiteSpace: 'nowrap', fontWeight: 700 } }} aria-label="Usuarios">
            <TableHead>
              <TableRow>
                <TableCell>{sortCell('name', 'Usuario')}</TableCell>
                <TableCell>Rol</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Plan</TableCell>
                <TableCell>{sortCell('created', 'Alta')}</TableCell>
                <TableCell>{sortCell('lastLogin', 'Último acceso')}</TableCell>
                <TableCell>Uso</TableCell>
                <TableCell align="right" sx={{ position: 'sticky', right: 0, zIndex: 3, bgcolor: 'background.paper' }}>Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.users.map((item) => {
                const expired = item.planExpiresAt !== null && Date.parse(item.planExpiresAt) < Date.now()
                return (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 240 }}>
                        <Avatar sx={{ bgcolor: item.status === 'SUSPENDED' ? 'text.disabled' : 'primary.main', width: 36, height: 36, fontSize: 14, fontWeight: 700 }}>{initials(item.name)}</Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{item.name}</Typography>
                            {item.isOwner && <Chip label="Propietario" size="small" color="primary" sx={{ height: 20 }} />}
                            {item.id === me?.id && !item.isOwner && <Chip label="Tú" size="small" variant="outlined" sx={{ height: 20 }} />}
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{item.email ?? 'Sin correo'}</Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell><Chip label={ROLE_LABEL[item.role]} size="small" variant={item.role === 'ADMIN' ? 'filled' : 'outlined'} /></TableCell>
                    <TableCell><Chip label={STATUS_LABEL[item.status]} size="small" color={STATUS_COLOR[item.status]} variant="outlined" /></TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{PLAN_SHORT[item.plan]}</Typography>
                      {item.planExpiresAt && (
                        <Typography variant="caption" color={expired ? 'error' : 'text.secondary'} sx={{ whiteSpace: 'nowrap' }}>
                          {expired ? 'Venció' : 'Vence'} {formatDate(item.planExpiresAt)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(item.createdAt)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {item.lastLoginAt
                        ? <Tooltip title={new Date(item.lastLoginAt).toLocaleString('es')}><span>{formatDate(item.lastLoginAt)}</span></Tooltip>
                        : <Typography variant="body2" color="text.secondary">Nunca</Typography>}
                    </TableCell>
                    <TableCell><UsageCell user={item} /></TableCell>
                    <TableCell align="right" sx={{ position: 'sticky', right: 0, bgcolor: 'background.paper' }}>
                      <IconButton aria-label={`Acciones de ${item.name}`} aria-haspopup="menu" onClick={(e) => setMenu({ anchor: e.currentTarget, user: item })}>⋯</IconButton>
                    </TableCell>
                  </TableRow>
                )
              })}
              {data && data.users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 5 }}>
                    <Typography color="text.secondary">No hay usuarios que coincidan con la búsqueda.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={data?.total ?? 0}
          page={query.page - 1}
          rowsPerPage={query.pageSize}
          rowsPerPageOptions={PAGE_SIZES}
          onPageChange={(_, page) => update({ pagina: page > 0 ? String(page + 1) : undefined }, false)}
          onRowsPerPageChange={(e) => update({ tam: e.target.value === '50' ? undefined : e.target.value })}
          labelRowsPerPage="Usuarios por página"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
        />
      </Paper>

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem key="stats" onClick={() => navigate(`/administracion/usuarios/${menu.user.id}/estadisticas`)}>Ver estadísticas</MenuItem>,
          <MenuItem key="plan" onClick={() => { setDialog({ user: menu.user, action: 'plan' }); setMenu(null) }}>Cambiar plan…</MenuItem>,
          <MenuItem key="quota" onClick={() => { setDialog({ user: menu.user, action: 'quota' }); setMenu(null) }}>Cambiar cuota…</MenuItem>,
          isOwner && !menu.user.isOwner && (
            <MenuItem key="role" disabled={menu.user.role === 'USER' && menu.user.status !== 'ACTIVE'}
              onClick={() => { setDialog({ user: menu.user, action: 'role' }); setMenu(null) }}>
              {menu.user.role === 'ADMIN' ? 'Retirar administrador…' : 'Hacer administrador…'}
            </MenuItem>
          ),
          <MenuItem key="status" disabled={cannotSuspend(menu.user)} sx={{ color: menu.user.status === 'SUSPENDED' ? undefined : 'error.main' }}
            onClick={() => { setDialog({ user: menu.user, action: 'status' }); setMenu(null) }}>
            {menu.user.status === 'SUSPENDED' ? 'Reactivar cuenta…' : 'Suspender cuenta…'}
          </MenuItem>,
        ]}
      </Menu>

      {dialog && (
        <AdminUserDialog
          user={dialog.user}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null)
            setNotice(message)
            setRefresh((value) => value + 1)
          }}
        />
      )}
    </Stack>
  )
}
