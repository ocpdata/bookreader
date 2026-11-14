import { useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { MAX_AUDIO_BYTES, audioContentType, createSummary, updateSummary } from '../api'
import type { Category, Summary } from '../types'

interface Props {
  categories: Category[]
  summary?: Summary
  onDone: () => void
  onCancel: () => void
}

export default function SummaryForm({ categories, summary, onDone, onCancel }: Props) {
  const editing = Boolean(summary)
  const [title, setTitle] = useState(summary?.title ?? '')
  const [author, setAuthor] = useState(summary?.author ?? '')
  const [categoryId, setCategoryId] = useState(summary?.categoryId ?? '')
  const [description, setDescription] = useState(summary?.description ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!editing) {
      if (!file) return setError('Selecciona un archivo MP3 o M4A')
      if (!audioContentType(file.name)) return setError('El archivo debe ser MP3 o M4A')
      if (file.size > MAX_AUDIO_BYTES) return setError('El archivo supera el máximo de 200 MB')
    }

    const fields = { title, author, description, categoryId }
    setSaving(true)
    try {
      if (summary) await updateSummary(summary.id, fields)
      else await createSummary(fields, file!)
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <Typography variant="h5" component="h1">
          {editing ? 'Editar resumen' : 'Agregar resumen'}
        </Typography>
        <TextField label="Título del libro" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <TextField label="Autor" value={author} onChange={(e) => setAuthor(e.target.value)} required />
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
        <TextField
          label="Descripción (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          minRows={3}
        />
        {editing ? (
          <Typography variant="body2" color="text.secondary">
            Audio actual: {summary!.originalFilename} (no se puede reemplazar).
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
        {saving && !editing && <Alert severity="info">Subiendo audio, no cierres esta página…</Alert>}
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={saving}>
            {editing ? 'Guardar' : 'Subir resumen'}
          </Button>
          <Button onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        </Stack>
      </Stack>
    </form>
  )
}
