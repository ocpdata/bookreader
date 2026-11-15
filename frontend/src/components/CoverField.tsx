import { useEffect, useMemo, useState } from 'react'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { coverFromAudio, removeCover, uploadCover } from '../api'
import { prepareCover } from '../cover'
import CoverImage from './CoverImage'

interface Props {
  title: string
  seed: string
  /** Portada actual del audio guardado (edición). */
  coverUrl: string | null
  /** Con id, los cambios se aplican de inmediato; sin él (alta) la imagen elegida se sube al guardar. */
  summaryId?: string
  pending: Blob | null
  onPending: (blob: Blob | null) => void
  onChanged: (coverUrl: string | null) => void
  onError: (message: string) => void
}

export default function CoverField({ title, seed, coverUrl, summaryId, pending, onPending, onChanged, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const preview = useMemo(() => (pending ? URL.createObjectURL(pending) : null), [pending])
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview])
  const shown = preview ?? coverUrl

  async function run(action: () => Promise<void>) {
    setBusy(true)
    onError('')
    try {
      await action()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pick = (file: File | undefined) =>
    file &&
    run(async () => {
      const image = await prepareCover(file)
      if (!summaryId) return onPending(image)
      onChanged((await uploadCover(summaryId, image)).coverUrl)
    })

  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
      <CoverImage src={shown} title={title || '?'} seed={seed} size={96} />
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="subtitle2">Portada (opcional)</Typography>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button component="label" size="small" variant="outlined" disabled={busy}>
            {shown ? 'Cambiar imagen' : 'Elegir imagen'}
            <input
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                void pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </Button>
          {summaryId && (
            <Button
              size="small"
              disabled={busy}
              onClick={() => run(async () => onChanged((await coverFromAudio(summaryId)).coverUrl))}
            >
              Usar la del audio
            </Button>
          )}
          {shown && (
            <Button
              size="small"
              color="error"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (summaryId && coverUrl) await removeCover(summaryId)
                  onPending(null)
                  onChanged(null)
                })
              }
            >
              Quitar
            </Button>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          JPEG, PNG o WebP; se reduce a 800 px. Si el audio trae portada incrustada se usa sola.
        </Typography>
      </Stack>
    </Stack>
  )
}
