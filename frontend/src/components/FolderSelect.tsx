import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { MAX_DEPTH, folderOptions, heightOf, pathOf, subtreeIds } from '../folders'
import type { Folder } from '../types'

interface Props {
  folders: Folder[]
  /** Id de carpeta o '' para la raíz (sin carpeta). */
  value: string
  onChange: (folderId: string) => void
  label?: string
  /** Carpeta que se está moviendo: ni ella ni sus descendientes son destinos válidos. */
  moving?: string
  /** Se elige el padre de una carpeta nueva: solo cuentan los destinos con espacio para otro nivel. */
  creating?: boolean
  fullWidth?: boolean
  size?: 'small' | 'medium'
  autoFocus?: boolean
  disabled?: boolean
}

export default function FolderSelect({
  folders,
  value,
  onChange,
  label = 'Carpeta',
  moving,
  creating = false,
  fullWidth = true,
  size,
  autoFocus,
  disabled,
}: Props) {
  const exclude = moving ? subtreeIds(folders, moving) : new Set<string>()
  // Una carpeta (nueva o movida, con sus subcarpetas) no puede superar los niveles permitidos.
  const limited = Boolean(moving) || creating
  const height = moving ? heightOf(folders, moving) : 1
  const options = folderOptions(folders, exclude).filter((o) => !limited || o.depth + 1 + height <= MAX_DEPTH)
  // Si la carpeta actual ya no es una opción (borrada), se muestra como raíz.
  const current = options.some((o) => o.id === value) ? value : ''

  return (
    <TextField
      select
      label={label}
      value={current}
      onChange={(e) => onChange(e.target.value)}
      fullWidth={fullWidth}
      size={size}
      autoFocus={autoFocus}
      disabled={disabled}
      slotProps={{
        inputLabel: { shrink: true },
        select: {
          displayEmpty: true,
          renderValue: (v) => (v ? pathOf(folders, v as string).map((f) => f.name).join(' › ') : 'Sin carpeta (raíz)'),
        },
      }}
    >
      <MenuItem value="">Sin carpeta (raíz)</MenuItem>
      {options.map((o) => (
        <MenuItem key={o.id} value={o.id} sx={{ pl: 2 + o.depth * 2 }}>
          {o.label.split(' › ').pop()}
        </MenuItem>
      ))}
    </TextField>
  )
}
