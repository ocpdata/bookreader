import { useEffect, useState } from 'react'
import { Link as RouterLink, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { listCategories } from './api'
import HomeView from './components/HomeView'
import LibraryView from './components/LibraryView'
import SummaryDetail from './components/SummaryDetail'
import SummaryForm from './components/SummaryForm'
import type { Category } from './types'

export default function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ color: 'inherit', textDecoration: 'none' }}
          >
            📚 BookReader
          </Typography>
          <Button color="inherit" component={NavLink} to="/" end sx={{ ml: 3, '&.active': { textDecoration: 'underline' } }}>
            Inicio
          </Button>
          <Button color="inherit" component={NavLink} to="/biblioteca" sx={{ '&.active': { textDecoration: 'underline' } }}>
            Biblioteca
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Routes>
          <Route path="/" element={<HomeView />} />
          <Route path="/biblioteca" element={<LibraryView categories={categories} />} />
          <Route path="/audios/nuevo" element={<SummaryForm categories={categories} />} />
          <Route path="/audios/:id" element={<SummaryDetail />} />
          <Route path="/audios/:id/editar" element={<SummaryForm categories={categories} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
    </>
  )
}
