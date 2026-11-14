import { useEffect, useState } from 'react'
import AppBar from '@mui/material/AppBar'
import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { listCategories } from './api'
import LibraryView from './components/LibraryView'
import SummaryDetail from './components/SummaryDetail'
import SummaryForm from './components/SummaryForm'
import type { Category, Summary } from './types'

type View =
  | { name: 'library' }
  | { name: 'detail'; id: string }
  | { name: 'form'; summary?: Summary }

export default function App() {
  const [view, setView] = useState<View>({ name: 'library' })
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch((e: Error) => setError(e.message))
  }, [])

  const goLibrary = () => {
    setRefreshKey((k) => k + 1)
    setView({ name: 'library' })
  }

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">📚 BookReader</Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {view.name === 'library' && (
          <LibraryView
            categories={categories}
            refreshKey={refreshKey}
            onAdd={() => setView({ name: 'form' })}
            onListen={(s) => setView({ name: 'detail', id: s.id })}
            onEdit={(s) => setView({ name: 'form', summary: s })}
          />
        )}
        {view.name === 'detail' && (
          <SummaryDetail
            id={view.id}
            onBack={goLibrary}
            onEdit={(s) => setView({ name: 'form', summary: s })}
          />
        )}
        {view.name === 'form' && (
          <SummaryForm
            categories={categories}
            summary={view.summary}
            onDone={goLibrary}
            onCancel={goLibrary}
          />
        )}
      </Container>
    </>
  )
}
