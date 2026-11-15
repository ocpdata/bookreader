import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { deleteForever, emptyTrash, listTrash, restoreSummary } from '../api'
import { formatBytes, formatDate, formatDuration } from '../format'
import type { TrashItem } from '../types'
import ConfirmDialog from './ConfirmDialog'

type Pending = { kind: 'one'; item: TrashItem } | { kind: 'all' } | null

const plural = (n: number) => (n === 1 ? '1 audio' : `${n} audios`)

export default function TrashView() {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  // El diálogo conserva su contenido mientras se cierra (si no, el texto cambia durante la animación).
  const lastPending = useRef<Pending>(null)
  if (pending) lastPending.current = pending
  const shown = pending ?? lastPending.current

  const load = () =>
    listTrash()
      .then((list) => {
        setItems(list)
        setError('')
      })
      .catch((e: Error) => setError(e.message))

  useEffect(() => {
    void load()
  }, [])

  async function restore(item: TrashItem) {
    setNotice('')
    try {
      await restoreSummary(item.id)
      setItems((list) => list?.filter((i) => i.id !== item.id) ?? null)
      setNotice(`«${item.title}» volvió a tu biblioteca.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function confirmDelete() {
    if (!pending) return
    setBusy(true)
    setNotice('')
    try {
      if (pending.kind === 'one') {
        await deleteForever(pending.item.id)
        setNotice(`«${pending.item.title}» se eliminó definitivamente.`)
      } else {
        const { deleted, failed } = await emptyTrash()
        setNotice(
          failed > 0
            ? `Se eliminó ${plural(deleted)}; ${failed} no se pudo borrar ahora y se reintentará.`
            : `Papelera vacía: se eliminó ${plural(deleted)}.`,
        )
      }
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  if (!items && !error) {
    return (
      <Box sx={{ textAlign: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="h1">
          Papelera
        </Typography>
        {items && items.length > 0 && (
          <Button color="error" onClick={() => setPending({ kind: 'all' })}>
            Vaciar papelera
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Los audios eliminados se conservan 30 días y luego se borran definitivamente.
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {items && items.length === 0 && <Typography color="text.secondary">La papelera está vacía.</Typography>}

      {items?.map((item) => (
        <Card key={item.id} variant="outlined">
          <CardContent>
            <Typography variant="h6">{item.title}</Typography>
            <Typography color="text.secondary">
              {[item.author, item.category, formatDuration(item.durationSeconds), formatBytes(item.sizeBytes)]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Eliminado el {formatDate(item.deletedAt)} · se borrará definitivamente el {formatDate(item.purgeAt)}
            </Typography>
          </CardContent>
          <CardActions>
            <Button onClick={() => restore(item)}>Restaurar</Button>
            <Button color="error" onClick={() => setPending({ kind: 'one', item })}>
              Eliminar definitivamente
            </Button>
          </CardActions>
        </Card>
      ))}

      <ConfirmDialog
        open={pending !== null}
        title={shown?.kind === 'all' ? '¿Vaciar la papelera?' : '¿Eliminar definitivamente?'}
        message={
          shown?.kind === 'all'
            ? `Se borrarán para siempre ${plural(items?.length ?? 0)} y sus archivos. Esta acción no se puede deshacer.`
            : shown?.kind === 'one'
              ? `«${shown.item.title}» y su archivo de audio se borrarán para siempre. Esta acción no se puede deshacer.`
              : ''
        }
        confirmLabel={shown?.kind === 'all' ? 'Vaciar papelera' : 'Eliminar definitivamente'}
        destructive
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
      />
    </Stack>
  )
}
