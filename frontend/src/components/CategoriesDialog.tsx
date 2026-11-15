import { useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SelectableCategory } from '../types'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  open: boolean
  categories: SelectableCategory[]
  onCreate: (name: string) => Promise<SelectableCategory>
  onDelete: (id: string) => Promise<void>
  onCreated?: (category: SelectableCategory) => void
  onDeleted?: (id: string) => void
  onClose: () => void
}

export default function CategoriesDialog({ open, categories, onCreate, onDelete, onCreated, onDeleted, onClose }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toDelete, setToDelete] = useState<SelectableCategory | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    setError('')
    setBusy(true)
    try {
      const category = await onCreate(name)
      setName('')
      onCreated?.(category)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!toDelete) return
    setError('')
    setBusy(true)
    try {
      await onDelete(toDelete.id)
      onDeleted?.(toDelete.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setToDelete(null)
      setBusy(false)
    }
  }

  function close() {
    setError('')
    setName('')
    onClose()
  }

  return (
    <>
      <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="xs" aria-labelledby="categories-title">
        <DialogTitle id="categories-title">Mis categorías</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <form onSubmit={create}>
              <Stack direction="row" spacing={1}>
                <TextField label="Nueva categoría" value={name} onChange={(e) => setName(e.target.value)}
                  slotProps={{ htmlInput: { maxLength: 100 } }} required fullWidth disabled={busy} />
                <Button type="submit" variant="contained" disabled={busy}>Crear</Button>
              </Stack>
            </form>
            {error && <Alert severity="error">{error}</Alert>}
            <Typography variant="body2">Puedes eliminar tus categorías si no tienen audios asociados.</Typography>
            {categories.filter((category) => category.isCustom).map((category) => (
              <Stack key={category.id} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography>{category.name}</Typography>
                <Button color="error" disabled={busy} onClick={() => setToDelete(category)}>Eliminar</Button>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={close} disabled={busy}>Cerrar</Button></DialogActions>
      </Dialog>
      <ConfirmDialog open={Boolean(toDelete)} title="Eliminar categoría" message={`¿Eliminar «${toDelete?.name ?? ''}»?`}
        confirmLabel="Eliminar" destructive busy={busy} onConfirm={remove} onCancel={() => setToDelete(null)} />
    </>
  )
}
