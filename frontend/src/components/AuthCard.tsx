import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

/** Tarjeta centrada de las pantallas públicas (acceso, registro, verificación y recuperación). */
export default function AuthCard({ title, children, width = 400 }: { title: string; children: ReactNode; width?: number }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
      <Paper variant="outlined" sx={{ p: 3, width: '100%', maxWidth: width }}>
        <Stack spacing={2}>
          <Typography variant="h5" component="h1">
            {title}
          </Typography>
          {children}
        </Stack>
      </Paper>
    </Box>
  )
}
