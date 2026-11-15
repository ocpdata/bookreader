import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import { moveSummaries } from '../api'
import type { Folder, Summary } from '../types'
import FolderSelect from './FolderSelect'

interface Props {
  summary: Summary | null
  folders: Folder[]
  onMoved: (summary: Summary, folderId: string | null) => void
  onClose: () => void
}

export default function MoveToFolderDialog({ summary, folders, onMoved, onClose }: Props) {
  const [folderId, setFolderId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setFolderId(summary?.folderId ?? '')
    setError('')
  }, [summary])

  async function move() {
    if (!summary) return
    setBusy(true)
    try {
      await moveSummaries([summary.id], folderId || null)
      onMoved(summary, folderId || null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={summary !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="move-title">
      <DialogTitle id="move-title">Mover a una carpeta</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <FolderSelect folders={folders} value={folderId} onChange={setFolderId} label={`Destino de «${summary?.title ?? ''}»`} autoFocus />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={move} variant="contained" disabled={busy || (summary?.folderId ?? '') === folderId}>
          Mover
        </Button>
      </DialogActions>
    </Dialog>
  )
}
