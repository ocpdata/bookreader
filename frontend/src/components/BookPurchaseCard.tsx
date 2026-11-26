import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

/**
 * Invitación a comprar el libro completo. El enlace es de afiliado (BookBrief puede recibir una comisión), así que el
 * aviso va siempre a la vista y el enlace se marca como patrocinado.
 */
export default function BookPurchaseCard({ url, finished = false }: { url: string; finished?: boolean }) {
  return (
    <Paper variant="outlined" component="aside" aria-label="Comprar el libro" sx={{ p: 2.5, borderRadius: '16px', bgcolor: finished ? 'action.hover' : undefined }}>
      <Stack spacing={1.25}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {finished ? 'Terminaste el resumen. ¿Quieres el libro completo?' : '¿Te gustó este resumen? Consigue el libro completo'}
        </Typography>
        <Button component="a" href={url} target="_blank" rel="sponsored noopener" variant={finished ? 'contained' : 'outlined'} sx={{ alignSelf: 'flex-start' }}>
          Comprar el libro
        </Button>
        <Typography variant="caption" color="text.secondary">
          Enlace de afiliado: BookBrief puede recibir una comisión si compras, sin costo adicional para ti. Al abrirlo se envían a la tienda
          el título y el autor del libro (o su ISBN) y tu dirección IP.
        </Typography>
      </Stack>
    </Paper>
  )
}
