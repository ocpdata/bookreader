import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { MAX_AUDIO_BYTES, audioContentType, createSummary, getSummary, listTags, updateSummary } from '../api'
import { formatDuration } from '../format'
import type { Category, Summary, TagSuggestion } from '../types'

const MAX_TAGS = 10

interface Props {
  categories: Category[]
}

export default function SummaryForm({ categories }: Props) {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = Boolean(id)

  const [original, setOriginal] = useState<Summary | null>(null)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [summaryTitle, setSummaryTitle] = useState('')
  const [narrator, setNarrator] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagQuery, setTagQuery] = useState('')
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
        setDescription(s.description ?? '')
        setTags(s.tags)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id])

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
    }

    const fields = { title, author, summaryTitle, narrator, description, categoryId, tags }
    setSaving(true)
    try {
      if (id) await updateSummary(id, fields)
      else await createSummary(fields, file!)
      navigate('/')
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
        <TextField label="Título del libro" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <TextField label="Autor del libro" value={author} onChange={(e) => setAuthor(e.target.value)} required />
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
