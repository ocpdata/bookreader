import { useEffect, useState, type ReactNode } from 'react'
import { Link as RouterLink, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { createCategory, deleteCategory, listCategories, type CurrentUser } from './api'
import { useAuth } from './auth'
import AccountView from './components/AccountView'
import AdminUsersView from './components/AdminUsersView'
import ResourcesView from './components/ResourcesView'
import BatchUploadView from './components/BatchUploadView'
import ForgotPasswordView from './components/ForgotPasswordView'
import HomeView from './components/HomeView'
import { PrivacyView, TermsView } from './components/LegalViews'
import LandingView from './components/LandingView'
import LibraryView from './components/LibraryView'
import LoginView from './components/LoginView'
import RegisterView from './components/RegisterView'
import ResetPasswordView from './components/ResetPasswordView'
import SummaryDetail from './components/SummaryDetail'
import SummaryForm from './components/SummaryForm'
import StatisticsView from './components/StatisticsView'
import TermsGate from './components/TermsGate'
import TrashView from './components/TrashView'
import VerifyEmailView from './components/VerifyEmailView'
import type { SelectableCategory } from './types'

const navSx = {
  color: 'text.secondary',
  whiteSpace: 'nowrap',
  '&.active': { color: 'primary.dark', bgcolor: '#E6F3F3', fontWeight: 700 },
}

/** Sin sesión lleva al acceso y, tras entrar, vuelve a la página que se pidió. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  if (user === undefined) {
    return (
      <Box sx={{ textAlign: 'center', pt: 4 }}>
        <CircularProgress size={28} />
      </Box>
    )
  }
  if (!user) return <Navigate to="/entrar" replace state={{ from: `${location.pathname}${location.search}` }} />
  return <>{children}</>
}

/** `/` es el inicio con sesión y la portada pública sin ella. */
function HomeOrLanding() {
  const { user } = useAuth()
  if (user === undefined) {
    return (
      <Box sx={{ textAlign: 'center', pt: 4 }}>
        <CircularProgress size={28} />
      </Box>
    )
  }
  return user ? <HomeView /> : <LandingView />
}

export default function App() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isLanding = user === null && location.pathname === '/'
  const [categoryState, setCategoryState] = useState<{ user: CurrentUser; items: SelectableCategory[] } | null>(null)
  const [error, setError] = useState('')
  const categories = user && categoryState?.user === user ? categoryState.items : []
  const categoriesReady = Boolean(user && categoryState?.user === user)

  // Las categorías requieren sesión: se cargan al iniciarla.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    listCategories()
      .then((items) => { if (!cancelled) setCategoryState({ user, items }) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [user])

  async function addCategory(name: string) {
    if (!user) throw new Error('Inicia sesión para crear una categoría')
    const category = await createCategory(name)
    setCategoryState((previous) => previous?.user === user
      ? { ...previous, items: [...previous.items, category].sort((a, b) => a.name.localeCompare(b.name, 'es')) }
      : previous)
    return category
  }

  async function removeCategory(id: string) {
    if (!user) throw new Error('Inicia sesión para eliminar una categoría')
    await deleteCategory(id)
    setCategoryState((previous) => previous?.user === user
      ? { ...previous, items: previous.items.filter((category) => category.id !== id) }
      : previous)
  }

  async function handleLogout() {
    // Primero se sale de la página protegida: si no, RequireAuth redirige a /entrar al quedar sin sesión.
    navigate('/', { replace: true })
    await logout()
  }

  return (
    <>
      <AppBar position="static" color="inherit" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ maxWidth: 1320, width: '100%', mx: 'auto', gap: { xs: 1, sm: 2 }, flexWrap: 'wrap', py: { xs: 1, md: 1.5 } }}>
          <Stack component={RouterLink} to="/" direction="row" spacing={1.2}
            sx={{ alignItems: 'center', color: 'text.primary', textDecoration: 'none', flexShrink: 0 }}>
            <Box component="img" src="/logo.svg" alt="" aria-hidden="true" sx={{ width: 36, height: 36, display: 'block' }} />
            <Typography variant="h6">BookBrief</Typography>
          </Stack>
          {user === null && (
            <>
              <Box sx={{ flexGrow: 1 }} />
              <Button component={RouterLink} to="/entrar" variant="outlined">Entrar</Button>
            </>
          )}
          {user && (
            <>
              <Box sx={{ flexGrow: 1 }} />
              <Stack component="nav" aria-label="Navegación principal" direction="row" spacing={0.5}
                sx={{ order: { xs: 3, md: 0 }, flexBasis: { xs: '100%', md: 'auto' }, overflowX: 'auto' }}>
                <Button component={NavLink} to="/" end sx={navSx}>Inicio</Button>
                <Button component={NavLink} to="/biblioteca" sx={navSx}>Biblioteca</Button>
                <Button component={NavLink} to="/estadisticas" sx={navSx}>Estadísticas</Button>
                <Button component={NavLink} to="/papelera" sx={navSx}>Papelera</Button>
                {user.role === 'ADMIN' && <Button component={NavLink} to="/administracion" sx={navSx}>Administración</Button>}
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                <Button component={NavLink} to="/cuenta" sx={{ ...navSx, maxWidth: { xs: 140, sm: 220 }, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.name}
                </Button>
                <Button color="inherit" onClick={handleLogout}>Salir</Button>
              </Stack>
            </>
          )}
        </Toolbar>
      </AppBar>
      <Container maxWidth={isLanding ? false : 'lg'} disableGutters={isLanding} sx={{ py: isLanding ? 0 : { xs: 3, md: 5 } }}>
        <TermsGate />
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Routes>
          <Route path="/entrar" element={<LoginView />} />
          <Route path="/registro" element={<RegisterView />} />
          <Route path="/verificar" element={<VerifyEmailView />} />
          <Route path="/olvide" element={<ForgotPasswordView />} />
          <Route path="/restablecer" element={<ResetPasswordView />} />
          <Route path="/terminos" element={<TermsView />} />
          <Route path="/privacidad" element={<PrivacyView />} />
          <Route path="/" element={<HomeOrLanding />} />
          <Route path="/biblioteca" element={<RequireAuth><LibraryView categories={categories} categoriesReady={categoriesReady} onCreateCategory={addCategory} onDeleteCategory={removeCategory} /></RequireAuth>} />
          <Route path="/papelera" element={<RequireAuth><TrashView /></RequireAuth>} />
          <Route path="/cuenta" element={<RequireAuth><AccountView /></RequireAuth>} />
          <Route path="/estadisticas" element={<RequireAuth><StatisticsView /></RequireAuth>} />
          <Route path="/administracion" element={<RequireAuth><AdminUsersView /></RequireAuth>} />
          <Route path="/administracion/estadisticas" element={<RequireAuth><StatisticsView admin /></RequireAuth>} />
          <Route path="/administracion/recursos" element={<RequireAuth><ResourcesView /></RequireAuth>} />
          <Route path="/administracion/usuarios/:id/estadisticas" element={<RequireAuth><StatisticsView admin /></RequireAuth>} />
          <Route path="/audios/nuevo" element={<RequireAuth><SummaryForm categories={categories} categoriesReady={categoriesReady} onCreateCategory={addCategory} onDeleteCategory={removeCategory} /></RequireAuth>} />
          <Route path="/audios/lote" element={<RequireAuth><BatchUploadView categories={categories} /></RequireAuth>} />
          <Route path="/audios/:id" element={<RequireAuth><SummaryDetail /></RequireAuth>} />
          <Route path="/audios/:id/editar" element={<RequireAuth><SummaryForm categories={categories} categoriesReady={categoriesReady} onCreateCategory={addCategory} onDeleteCategory={removeCategory} /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
    </>
  )
}
