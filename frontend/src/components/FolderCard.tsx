import { useState } from 'react'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { Folder } from '../types'

interface Props {
  folder: Folder
  /** Audios en la carpeta y sus subcarpetas. */
  total: number
  subfolders: number
  onOpen: (folder: Folder) => void
  onEdit: (folder: Folder) => void
  onDelete: (folder: Folder) => void
}

export default function FolderCard({ folder, total, subfolders, onOpen, onEdit, onDelete }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const detail = [
    `${total} ${total === 1 ? 'audio' : 'audios'}`,
    subfolders > 0 ? `${subfolders} ${subfolders === 1 ? 'subcarpeta' : 'subcarpetas'}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card variant="outlined">
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <CardActionArea onClick={() => onOpen(folder)} sx={{ p: 1.5, flexGrow: 1 }}>
          <Typography variant="subtitle1">📁 {folder.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {detail}
          </Typography>
        </CardActionArea>
        <IconButton aria-label={`Opciones de ${folder.name}`} onClick={(e) => setAnchor(e.currentTarget)} sx={{ mr: 0.5 }}>
          ⋯
        </IconButton>
        <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
          <MenuItem
            onClick={() => {
              setAnchor(null)
              onEdit(folder)
            }}
          >
            Renombrar o mover
          </MenuItem>
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={() => {
              setAnchor(null)
              onDelete(folder)
            }}
          >
            Eliminar carpeta
          </MenuItem>
        </Menu>
      </Stack>
    </Card>
  )
}
