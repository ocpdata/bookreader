import { useEffect, useState } from 'react'
import { Link as RouterLink, Navigate, Route, Routes } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { listCategories } from './api'
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
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Routes>
          <Route path="/" element={<LibraryView categories={categories} />} />
          <Route path="/audios/nuevo" element={<SummaryForm categories={categories} />} />
          <Route path="/audios/:id" element={<SummaryDetail />} />
          <Route path="/audios/:id/editar" element={<SummaryForm categories={categories} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
    </>
  )
}
