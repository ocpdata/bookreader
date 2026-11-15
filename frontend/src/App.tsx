import { useEffect, useState, type ReactNode } from 'react'
import { Link as RouterLink, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { listCategories } from './api'
import { useAuth } from './auth'
import AccountView from './components/AccountView'
import HomeView from './components/HomeView'
import LibraryView from './components/LibraryView'
import LoginView from './components/LoginView'
import SummaryDetail from './components/SummaryDetail'
import SummaryForm from './components/SummaryForm'
import TrashView from './components/TrashView'
import type { Category } from './types'

const navSx = { '&.active': { textDecoration: 'underline' } }

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
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  return <>{children}</>
}

export default function App() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState('')

  // Las categorías requieren sesión: se cargan al iniciarla.
  useEffect(() => {
    if (!user) return
    listCategories()
      .then(setCategories)
      .catch((e: Error) => setError(e.message))
  }, [user])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component={RouterLink} to="/" sx={{ color: 'inherit', textDecoration: 'none' }}>
            📚 BookReader
          </Typography>
          {user && (
            <>
              <Button color="inherit" component={NavLink} to="/" end sx={{ ml: 3, ...navSx }}>
                Inicio
              </Button>
              <Button color="inherit" component={NavLink} to="/biblioteca" sx={navSx}>
                Biblioteca
              </Button>
              <Button color="inherit" component={NavLink} to="/papelera" sx={navSx}>
                Papelera
              </Button>
              <Box sx={{ flexGrow: 1 }} />
              <Button color="inherit" component={NavLink} to="/cuenta" sx={navSx}>
                {user.name}
              </Button>
              <Button color="inherit" onClick={handleLogout}>
                Salir
              </Button>
            </>
          )}
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Routes>
          <Route path="/login" element={<LoginView />} />
          <Route path="/" element={<RequireAuth><HomeView /></RequireAuth>} />
          <Route path="/biblioteca" element={<RequireAuth><LibraryView categories={categories} /></RequireAuth>} />
          <Route path="/papelera" element={<RequireAuth><TrashView /></RequireAuth>} />
          <Route path="/cuenta" element={<RequireAuth><AccountView /></RequireAuth>} />
          <Route path="/audios/nuevo" element={<RequireAuth><SummaryForm categories={categories} /></RequireAuth>} />
          <Route path="/audios/:id" element={<RequireAuth><SummaryDetail /></RequireAuth>} />
          <Route path="/audios/:id/editar" element={<RequireAuth><SummaryForm categories={categories} /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
    </>
  )
}
