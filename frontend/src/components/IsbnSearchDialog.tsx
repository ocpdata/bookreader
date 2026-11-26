import { useEffect, useRef, useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { languageLabel, listEditions, searchWorks, type OpenLibraryEdition, type OpenLibraryWork } from '../openLibrary'

interface Props {
  title: string
  author: string
  /** Se llama con el ISBN-13 de la edición elegida. */
  onSelect: (isbn13: string) => void
  onClose: () => void
}

const rowSx = { p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }

/**
 * Busca el libro en Open Library desde el navegador (solo cuando la persona pulsa Buscar) y deja elegir la edición cuyo
 * ISBN se guardará. No se copia nada más: ni portadas, ni precios, ni otros datos.
 */
export default function IsbnSearchDialog({ title, author, onSelect, onClose }: Props) {
  const [bookTitle, setBookTitle] = useState(title)
  const [bookAuthor, setBookAuthor] = useState(author)
  const [works, setWorks] = useState<OpenLibraryWork[] | null>(null)
  const [work, setWork] = useState<OpenLibraryWork | null>(null)
  const [editions, setEditions] = useState<OpenLibraryEdition[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  async function run<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setBusy(true)
    setError('')
    try {
      return await action(current.signal)
    } catch (e) {
      if (!current.signal.aborted) setError((e as Error).message)
      return undefined
    } finally {
      if (controller.current === current) setBusy(false)
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault()
    // El diálogo vive dentro del formulario del resumen en el árbol de React: sin esto, el envío subiría el resumen.
    e.stopPropagation()
    if (!bookTitle.trim() && !bookAuthor.trim()) return
    setWork(null)
    setEditions(null)
    const result = await run((signal) => searchWorks(bookTitle, bookAuthor, signal))
    if (result) setWorks(result)
  }

  async function chooseWork(chosen: OpenLibraryWork) {
    setWork(chosen)
    setEditions(null)
    const result = await run((signal) => listEditions(chosen.key, signal))
    if (result) setEditions(result)
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="isbn-search-title">
      <DialogTitle id="isbn-search-title">Buscar el ISBN en Open Library</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box component="form" onSubmit={search}>
            <Stack spacing={2}>
              <TextField label="Título del libro" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 200 } }} fullWidth />
              <TextField label="Autor" value={bookAuthor} onChange={(e) => setBookAuthor(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 200 } }} fullWidth />
              <Alert severity="info">
                Al buscar se enviarán el título y autor indicados y tu dirección IP a Open Library. BookBrief solo guarda el ISBN
                que elijas: no copia portadas, precios ni otra información.
              </Alert>
              <Button type="submit" variant="contained" disabled={busy || (!bookTitle.trim() && !bookAuthor.trim())} sx={{ alignSelf: 'flex-start' }}>
                Buscar
              </Button>
            </Stack>
          </Box>

          {busy && <CircularProgress size={28} />}
          {error && <Alert severity="error">{error}</Alert>}

          {!work && works && !busy && !error && (
            works.length === 0 ? (
              <Typography color="text.secondary">
                No hay resultados. Prueba con menos palabras del título, solo el apellido del autor, o escribe el ISBN a mano.
              </Typography>
            ) : (
              <Stack spacing={1} role="list" aria-label="Libros encontrados">
                {works.map((item) => (
                  <Box key={item.key} role="listitem" sx={rowSx}>
                    <Typography sx={{ fontWeight: 600 }}>{item.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {[item.authors.slice(0, 2).join(', '), item.year, item.editionCount ? `${item.editionCount} ${item.editionCount === 1 ? 'edición' : 'ediciones'}` : ''].filter(Boolean).join(' · ')}
                    </Typography>
                    <Button size="small" onClick={() => void chooseWork(item)} sx={{ mt: 0.5 }}>Ver ediciones</Button>
                  </Box>
                ))}
              </Stack>
            )
          )}

          {work && (
            <Stack spacing={1}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="subtitle2">Ediciones de «{work.title}»</Typography>
                <Button size="small" onClick={() => { setWork(null); setEditions(null); setError('') }}>← Volver</Button>
              </Stack>
              {editions && !busy && (
                editions.length === 0 ? (
                  <Typography color="text.secondary">Esta obra no tiene ediciones con ISBN. Prueba con otro resultado o escríbelo a mano.</Typography>
                ) : (
                  <Stack spacing={1} role="list" aria-label="Ediciones encontradas">
                    {editions.map((edition) => (
                      <Box key={edition.isbn13} role="listitem" sx={rowSx}>
                        <Typography sx={{ fontWeight: 600 }}>ISBN {edition.isbn13}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {[languageLabel(edition.language), edition.publisher, edition.year].filter(Boolean).join(' · ') || 'Sin más datos'}
                        </Typography>
                        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}>
                          <Button size="small" variant="contained" onClick={() => onSelect(edition.isbn13)}>Usar este ISBN</Button>
                          <Link href={`https://www.buscalibre.com.mx/libros/search?q=${edition.isbn13}`} target="_blank" rel="noopener noreferrer" variant="body2">
                            Verificar en Buscalibre
                          </Link>
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                )
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}
