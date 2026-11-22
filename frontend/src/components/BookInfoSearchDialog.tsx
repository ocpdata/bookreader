import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

interface Props {
  title: string
  author: string
  onClose: () => void
}

export default function BookInfoSearchDialog({ title, author, onClose }: Props) {
  const [bookTitle, setBookTitle] = useState(title)
  const [bookAuthor, setBookAuthor] = useState(author)
  const params = new URLSearchParams()
  if (bookTitle.trim()) params.set('title', bookTitle.trim())
  if (bookAuthor.trim()) params.set('author', bookAuthor.trim())
  const searchUrl = params.size ? `https://openlibrary.org/search?${params.toString()}` : undefined

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="book-info-search-title">
      <DialogTitle id="book-info-search-title">Buscar información en OpenLibrary.org</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography>
            Busca el libro en Open Library y consulta la información disponible.
          </Typography>
          <TextField label="Título del libro" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }} fullWidth />
          <TextField label="Autor" value={bookAuthor} onChange={(e) => setBookAuthor(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }} fullWidth />
          <Alert severity="info">
            Al abrir la búsqueda se enviarán el título y autor indicados y tu dirección IP a Open Library.
            BookBrief no copia información ni portadas automáticamente.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cerrar</Button>
        <Button component="a" href={searchUrl}
          target="_blank" rel="noopener noreferrer" variant="contained"
          disabled={!searchUrl}>
          Buscar en Open Library
        </Button>
      </DialogActions>
    </Dialog>
  )
}
