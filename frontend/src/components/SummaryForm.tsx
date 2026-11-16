import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  MAX_AUDIO_BYTES,
  audioContentType,
  createSummary,
  getSummary,
  getUsage,
  listFolders,
  listTags,
  updateSummary,
  uploadCover,
  type Usage,
} from '../api'
import { formatBytes, formatDuration } from '../format'
import type { SelectableCategory, Folder, Summary, TagSuggestion } from '../types'
import BookInfoSearchDialog from './BookInfoSearchDialog'
import CategoriesDialog from './CategoriesDialog'
import CoverField from './CoverField'
import FolderSelect from './FolderSelect'

const MAX_TAGS = 10

interface Props {
  categories: SelectableCategory[]
  categoriesReady: boolean
  onCreateCategory: (name: string) => Promise<SelectableCategory>
  onDeleteCategory: (id: string) => Promise<void>
}

export default function SummaryForm({ categories, categoriesReady, onCreateCategory, onDeleteCategory }: Props) {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = Boolean(id)
  const [searchParams] = useSearchParams()
  const location = useLocation()
  // Aviso tras un alta cuyo audio se guardó pero la portada no.
  const notice = (location.state as { notice?: string } | null)?.notice

  const [original, setOriginal] = useState<Summary | null>(null)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [summaryTitle, setSummaryTitle] = useState('')
  const [narrator, setNarrator] = useState('')
  const [categoryId, setCategoryId] = useState('')
  // Un audio nuevo nace en la carpeta desde la que se agregó.
  const [folderId, setFolderId] = useState(editing ? '' : (searchParams.get('carpeta') ?? ''))
  const [folders, setFolders] = useState<Folder[]>([])
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [pendingCover, setPendingCover] = useState<Blob | null>(null)
  const [tagQuery, setTagQuery] = useState('')
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState('')
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [bookSearchOpen, setBookSearchOpen] = useState(false)

  useEffect(() => {
    if (editing) return
    getUsage()
      .then(setUsage)
      .catch(() => undefined)
  }, [editing])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getSummary(id)
      .then((s) => {
        if (cancelled) return
        setOriginal(s)
        setTitle(s.title)
        setAuthor(s.author)
        setSummaryTitle(s.summaryTitle ?? '')
        setNarrator(s.narrator ?? '')
        setCategoryId(s.categoryId)
        setFolderId(s.folderId ?? '')
        setDescription(s.description ?? '')
        setTags(s.tags)
        setCoverUrl(s.coverUrl)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    listFolders()
      .then(setFolders)
      .catch(() => undefined)
  }, [])

  // Sugerencias: etiquetas ya usadas que coinciden con lo que se escribe.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      listTags(tagQuery.trim())
        .then((found) => !cancelled && setSuggestions(found))
        .catch(() => undefined)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tagQuery])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!editing) {
      if (!file) return setError('Selecciona un archivo MP3 o M4A')
      if (!audioContentType(file.name)) return setError('El archivo debe ser MP3 o M4A')
      if (file.size > MAX_AUDIO_BYTES) return setError('El archivo supera el máximo de 200 MB')
      // El servidor lo comprueba de nuevo; esto evita subir un archivo que se va a rechazar.
      if (usage && usage.audios >= usage.maxAudios) return setError(`Alcanzaste el máximo de ${usage.maxAudios} audios`)
      if (usage && file.size > usage.limitBytes - usage.usedBytes) {
        return setError(`No hay espacio: te quedan ${formatBytes(Math.max(0, usage.limitBytes - usage.usedBytes))} y el archivo ocupa ${formatBytes(file.size)}`)
      }
    }

    const fields = { title, author, summaryTitle, narrator, description, categoryId, folderId: folderId || null, tags }
    setSaving(true)
    try {
      if (id) await updateSummary(id, fields)
      else {
        const created = await createSummary(fields, file!)
        if (pendingCover) {
          try {
            await uploadCover(created.id, pendingCover)
          } catch (coverError) {
            // El audio ya existe: se lleva a su edición para reintentar la portada sin duplicarlo.
            navigate(`/audios/${created.id}/editar`, {
              state: { notice: `El audio se guardó, pero la portada no se pudo subir: ${(coverError as Error).message}` },
            })
            return
          }
        }
      }
      navigate(folderId ? `/biblioteca?carpeta=${folderId}` : '/biblioteca')
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  if (loading) return <CircularProgress size={28} />
  if (editing && !original) return <Alert severity="error">{error || 'Resumen no encontrado'}</Alert>

  return (
    <form onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <Typography variant="h5" component="h1">
          {editing ? 'Editar resumen' : 'Agregar resumen'}
        </Typography>
        {!editing && (
          <Button type="button" onClick={() => navigate(`/audios/lote${folderId ? `?carpeta=${encodeURIComponent(folderId)}` : ''}`)}
            sx={{ alignSelf: 'flex-start' }}>
            Subir varios audios
          </Button>
        )}
        {notice && <Alert severity="warning">{notice}</Alert>}
        <TextField label="Título del libro" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <TextField label="Autor del libro" value={author} onChange={(e) => setAuthor(e.target.value)} required />
        <Button type="button" variant="outlined" onClick={() => setBookSearchOpen(true)} sx={{ alignSelf: 'flex-start' }}>
          Buscar información en OpenLibrary.org
        </Button>
        {bookSearchOpen && <BookInfoSearchDialog title={title} author={author} onClose={() => setBookSearchOpen(false)} />}
        <TextField
          label="Título del resumen (opcional)"
          value={summaryTitle}
          onChange={(e) => setSummaryTitle(e.target.value)}
        />
        <TextField
          label="Narrador o creador del audio (opcional)"
          value={narrator}
          onChange={(e) => setNarrator(e.target.value)}
        />
        <TextField
          select
          label="Categoría"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          required
        >
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <Button type="button" disabled={!categoriesReady} onClick={() => setCategoriesOpen(true)}>Gestionar categorías</Button>
        <CategoriesDialog open={categoriesOpen} categories={categories} onCreate={onCreateCategory}
          onDelete={onDeleteCategory} onClose={() => setCategoriesOpen(false)}
          onCreated={(category) => setCategoryId(category.id)}
          onDeleted={(id) => { if (categoryId === id) setCategoryId('') }} />
        <CoverField
          title={title}
          seed={id ?? 'nuevo'}
          coverUrl={coverUrl}
          summaryId={id}
          pending={pendingCover}
          onPending={setPendingCover}
          onChanged={setCoverUrl}
          onError={setError}
        />
        <FolderSelect folders={folders} value={folderId} onChange={setFolderId} label="Carpeta" />
        <Autocomplete
          multiple
          freeSolo
          autoSelect
          options={suggestions.map((t) => t.name).filter((name) => !tags.some((t) => t.toLowerCase() === name.toLowerCase()))}
          value={tags}
          onChange={(_, value) => {
            const clean = value.map((v) => v.trim().replace(/\s+/g, ' ')).filter(Boolean)
            const unique = clean.filter((t, i) => clean.findIndex((o) => o.toLowerCase() === t.toLowerCase()) === i)
            if (unique.length <= MAX_TAGS) setTags(unique)
          }}
          onInputChange={(_, value) => setTagQuery(value)}
          renderInput={(inputParams) => (
            <TextField
              {...inputParams}
              label="Etiquetas (opcional)"
              helperText={`Escribe y pulsa Enter para añadir. Hasta ${MAX_TAGS}; se sugieren las que ya usaste.`}
            />
          )}
        />
        <TextField
          label="Descripción (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          minRows={3}
        />
        {original ? (
          <Typography variant="body2" color="text.secondary">
            Audio actual: {original.originalFilename}
            {original.durationSeconds ? ` · ${formatDuration(original.durationSeconds)}` : ''} (no se puede
            reemplazar).
          </Typography>
        ) : (
          <Button component="label" variant="outlined">
            {file ? file.name : 'Seleccionar audio (MP3 o M4A)'}
            <input
              type="file"
              hidden
              accept=".mp3,.m4a,audio/mpeg,audio/mp4"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Button>
        )}
        {!editing && usage && (
          <Typography variant="caption" color="text.secondary">
            Te quedan {formatBytes(Math.max(0, usage.limitBytes - usage.usedBytes))} de {formatBytes(usage.limitBytes)} y{' '}
            {Math.max(0, usage.maxAudios - usage.audios)} audios.
          </Typography>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {saving && !editing && <Alert severity="info">Subiendo y verificando el audio, no cierres esta página…</Alert>}
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={saving}>
            {editing ? 'Guardar' : 'Subir resumen'}
          </Button>
          <Button onClick={() => navigate(-1)} disabled={saving}>
            Cancelar
          </Button>
        </Stack>
      </Stack>
    </form>
  )
}
