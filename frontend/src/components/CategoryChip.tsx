import Chip from '@mui/material/Chip'
import { alpha } from '@mui/material/styles'

export default function CategoryChip({ name }: { name: string }) {
  return (
    <Chip
      label={`Categoría: ${name}`}
      size="small"
      sx={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        height: 'auto',
        minHeight: 24,
        color: 'primary.dark',
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
        '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.25 },
      }}
    />
  )
}
