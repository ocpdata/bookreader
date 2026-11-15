import { useEffect, useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import type { Folder } from '../types'
import FolderSelect from './FolderSelect'

interface Props {
  open: boolean
  folders: Folder[]
  /** Carpeta que se edita; sin ella, el diálogo crea una nueva. */
  folder?: Folder | null
  /** Ubicación inicial de una carpeta nueva ('' = raíz). */
  defaultParentId?: string
  onSubmit: (name: string, parentId: string | null) => Promise<void>
  onClose: () => void
}

/** Crear una carpeta o editar su nombre y ubicación. */
export default function FolderDialog({ open, folders, folder, defaultParentId = '', onSubmit, onClose }: Props) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(folder?.name ?? '')
    setParentId(folder ? (folder.parentId ?? '') : defaultParentId)
    setError('')
  }, [open, folder, defaultParentId])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Escribe un nombre')
    setBusy(true)
    try {
      await onSubmit(name, parentId || null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="folder-title">
      <form onSubmit={submit}>
        <DialogTitle id="folder-title">{folder ? 'Editar carpeta' : 'Nueva carpeta'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 100 } }}
              autoFocus
              required
              fullWidth
            />
            <FolderSelect
              folders={folders}
              value={parentId}
              onChange={setParentId}
              label="Ubicación"
              moving={folder?.id}
              creating={!folder}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {folder ? 'Guardar' : 'Crear'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
