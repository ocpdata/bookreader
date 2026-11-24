import { useEffect, useState, type FormEvent } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { acceptShare, createShare, getSharingConfig, listReceivedShares, listSentShares, listSummaries, rejectShare, resendShare, revokeShare } from '../api'
import type { Share, Summary } from '../types'
import ConfirmDialog from './ConfirmDialog'

const statusLabels = { PENDING: 'Pendiente', ACCEPTED: 'Aceptada', REJECTED: 'Rechazada', REVOKED: 'Revocada' }
const dateLabel = (value: string) => new Date(value).toLocaleString('es')
const expired = (share: Share) => share.status === 'PENDING' && Date.parse(share.expiresAt) <= Date.now()
const scopeLabel = (share: Share) => share.scope === 'LIBRARY'
  ? 'Biblioteca completa'
  : `${share.summaryIds.length} audio${share.summaryIds.length === 1 ? '' : 's'} seleccionado${share.summaryIds.length === 1 ? '' : 's'}`

export default function SharesView() {
  const [params] = useSearchParams()
  const initialAudio = params.get('audio') ?? ''
  const [sent, setSent] = useState<Share[]>([])
  const [received, setReceived] = useState<Share[]>([])
  const [sentLoaded, setSentLoaded] = useState(false)
  const [receivedLoaded, setReceivedLoaded] = useState(false)
  const [loadedRefresh, setLoadedRefresh] = useState(-1)
  const [configEnabled, setConfigEnabled] = useState<boolean | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [scope, setScope] = useState<Share['scope']>(initialAudio ? 'ITEMS' : 'LIBRARY')
  const [items, setItems] = useState<Summary[]>([])
  const [loadedItemsKey, setLoadedItemsKey] = useState('')
  const [itemsError, setItemsError] = useState('')
  const [itemsRefresh, setItemsRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>(initialAudio ? [initialAudio] : [])
  const [busy, setBusy] = useState(false)
  const [revoking, setRevoking] = useState<Share | null>(null)
  const [, updateClock] = useState(0)
  const loading = loadedRefresh !== refresh
  const enabled = loading ? null : configEnabled
  const itemsKey = `${refresh}:${scope}:${itemsRefresh}`
  const itemsLoading = loadedItemsKey !== itemsKey

  useEffect(() => {
    const timer = setInterval(() => updateClock((value) => value + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true
    Promise.allSettled([listSentShares(), listReceivedShares(), getSharingConfig()]).then(([sentResult, receivedResult, configResult]) => {
      if (!active) return
      setSent(sentResult.status === 'fulfilled' ? sentResult.value : [])
      setReceived(receivedResult.status === 'fulfilled' ? receivedResult.value : [])
      setSentLoaded(sentResult.status === 'fulfilled')
      setReceivedLoaded(receivedResult.status === 'fulfilled')
      setConfigEnabled(configResult.status === 'fulfilled' ? configResult.value.enabled : null)
      const errors = [sentResult, receivedResult, configResult]
        .filter((result) => result.status === 'rejected')
        .map((result) => (result.reason as Error).message)
      setError(errors.join(' · '))
      setLoadedRefresh(refresh)
    })
    return () => { active = false }
  }, [refresh])

  useEffect(() => {
    if (scope !== 'ITEMS' || enabled !== true) return
    let active = true
    listSummaries({ search: '', categoryId: '', tag: '', favorite: false, status: '', sort: 'title' })
      .then((result) => {
        if (!active) return
        const owned = result.filter((item) => item.isOwner !== false && item.status === 'READY')
        setItems(owned)
        setItemsError('')
        setSelectedIds((ids) => ids.filter((id) => owned.some((item) => item.id === id)))
      })
      .catch((e: Error) => { if (active) { setItems([]); setItemsError(e.message) } })
      .finally(() => { if (active) setLoadedItemsKey(itemsKey) })
    return () => { active = false }
  }, [scope, itemsRefresh, enabled, itemsKey])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || enabled !== true || !email.trim() || (scope === 'ITEMS' && (itemsLoading || itemsError || !selectedIds.length))) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await createShare({ email: email.trim(), scope, ...(scope === 'ITEMS' ? { summaryIds: selectedIds } : {}) })
      setEmail('')
      setSelectedIds([])
      setNotice('Invitación enviada.')
      setRefresh((value) => value + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function respond(share: Share, action: 'accept' | 'reject' | 'revoke' | 'resend') {
    if (busy || (action === 'resend' && share.status !== 'PENDING')
      || ((action === 'accept' || action === 'resend') && enabled !== true)
      || ((action === 'accept' || action === 'reject') && (share.status !== 'PENDING' || expired(share)))) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (action === 'accept') await acceptShare(share.id)
      else if (action === 'reject') await rejectShare(share.id)
      else if (action === 'resend') await resendShare(share.id)
      else await revokeShare(share.id)
      setRevoking(null)
      setNotice(action === 'accept' ? 'Invitación aceptada. Ya puedes escuchar los audios en Compartidos.'
        : action === 'reject' ? 'Invitación rechazada.'
          : action === 'resend' ? 'Invitación reenviada.' : 'Invitación revocada.')
      setRefresh((value) => value + 1)
    } catch (e) {
      setError((e as Error).message)
      setRevoking(null)
    } finally {
      setBusy(false)
    }
  }

  function invitation(share: Share, incoming: boolean) {
    const pending = share.status === 'PENDING' && !expired(share)
    return (
      <Paper key={share.id} variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography sx={{ overflowWrap: 'anywhere' }}>
              {incoming ? `De: ${share.ownerName}` : `Para: ${share.email}`}
            </Typography>
            <Chip size="small" label={expired(share) ? 'Vencida' : statusLabels[share.status]} />
          </Stack>
          <Typography variant="body2">{scopeLabel(share)}</Typography>
          {share.scope === 'ITEMS' && share.summaries.length > 0 && (
            <Box component="ul" sx={{ my: 0, pl: 3 }}>
              {share.summaries.map((item) => <li key={item.id}>{item.title} · {item.author}</li>)}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary">
            Creada: {dateLabel(share.createdAt)}
            {share.status === 'PENDING' ? ` · Vence: ${dateLabel(share.expiresAt)}` : ''}
          </Typography>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
            {incoming && pending && (
              <>
                {enabled === true && <Button variant="contained" disabled={busy || loading} onClick={() => respond(share, 'accept')}>Aceptar</Button>}
                <Button disabled={busy || loading} onClick={() => respond(share, 'reject')}>Rechazar</Button>
              </>
            )}
            {incoming && share.status === 'ACCEPTED' && <Button component={RouterLink} to="/compartidos">Ver audios compartidos</Button>}
            {!incoming && share.status === 'PENDING' && enabled === true && (
              <Button disabled={busy || loading} onClick={() => respond(share, 'resend')}>Reenviar</Button>
            )}
            {!incoming && (share.status === 'PENDING' || share.status === 'ACCEPTED') && (
              <Button color="error" disabled={busy || loading} onClick={() => setRevoking(share)}>Revocar</Button>
            )}
          </Stack>
        </Stack>
      </Paper>
    )
  }

  const visibleItems = items.filter((item) => `${item.title} ${item.author}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, justifyContent: 'space-between' }}>
        <Typography variant="h5" component="h1">Administrar invitaciones</Typography>
        <Button component={RouterLink} to="/compartidos">Ver audios compartidos</Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success" role="status">{notice}</Alert>}
      {enabled === false && (
        <Alert severity="info">Compartir está deshabilitado temporalmente. Puedes consultar, rechazar y revocar invitaciones, pero no crear, aceptar ni reenviar.</Alert>
      )}
      {enabled === true && <Paper component="form" variant="outlined" onSubmit={submit} sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">Compartir mis audios</Typography>
          <Typography color="text.secondary">
            Envía una invitación a un correo. Si la persona no tiene cuenta, podrá crearla con ese correo. Podrá escuchar y guardar sus favoritos, pero no editar ni eliminar tus audios.
          </Typography>
          <TextField label="Correo de la cuenta destinataria" type="email" required value={email}
            disabled={busy} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <TextField select label="Qué compartir" value={scope} disabled={busy}
            onChange={(e) => { setLoadedItemsKey(''); setScope(e.target.value as Share['scope']) }}>
            <MenuItem value="LIBRARY">Biblioteca completa</MenuItem>
            <MenuItem value="ITEMS">Audios seleccionados</MenuItem>
          </TextField>
          {scope === 'ITEMS' && (
            <Stack spacing={1}>
              <TextField label="Buscar mis audios por título o autor" value={search} disabled={busy} onChange={(e) => setSearch(e.target.value)} />
              <Typography variant="body2">{selectedIds.length} audios seleccionados (máximo 200)</Typography>
              {itemsLoading && <CircularProgress size={28} />}
              {itemsError && (
                <Alert severity="error" action={<Button disabled={busy} onClick={() => setItemsRefresh((value) => value + 1)}>Reintentar</Button>}>
                  {itemsError}
                </Alert>
              )}
              {!itemsLoading && !itemsError && (
                <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
                  {!items.length ? <Typography>No tienes audios propios disponibles para compartir.</Typography>
                    : !visibleItems.length ? <Typography>No hay audios que coincidan con la búsqueda.</Typography>
                      : visibleItems.map((item) => (
                        <FormControlLabel key={item.id} sx={{ display: 'flex', mx: 0 }}
                          label={`${item.title} · ${item.author}`}
                          control={<Checkbox checked={selectedIds.includes(item.id)} disabled={busy || (selectedIds.length >= 200 && !selectedIds.includes(item.id))}
                            onChange={(_, checked) => setSelectedIds((ids) => checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />} />
                      ))}
                </Box>
              )}
            </Stack>
          )}
          <Button type="submit" variant="contained" sx={{ alignSelf: 'flex-start' }}
            disabled={busy || !email.trim() || (scope === 'ITEMS' && (itemsLoading || Boolean(itemsError) || !selectedIds.length))}>
            {busy ? 'Procesando…' : 'Enviar invitación'}
          </Button>
        </Stack>
      </Paper>}
      <Button sx={{ alignSelf: 'flex-start' }} disabled={loading || busy} onClick={() => setRefresh((value) => value + 1)}>Actualizar invitaciones</Button>
      {loading && <CircularProgress size={28} />}
      <Stack spacing={1}>
        <Typography variant="h6" component="h2">Invitaciones recibidas</Typography>
        {!loading && receivedLoaded && !received.length && <Typography color="text.secondary">No hay invitaciones recibidas. Si esperas una, comprueba que iniciaste sesión con el correo al que fue enviada.</Typography>}
        {received.map((share) => invitation(share, true))}
      </Stack>
      <Stack spacing={1}>
        <Typography variant="h6" component="h2">Invitaciones enviadas</Typography>
        {!loading && sentLoaded && !sent.length && <Typography color="text.secondary">No hay invitaciones enviadas.</Typography>}
        {sent.map((share) => invitation(share, false))}
      </Stack>
      <ConfirmDialog open={revoking !== null} title="¿Revocar invitación?"
        message={`Se revocará este permiso para ${revoking?.email ?? ''}. Otros permisos vigentes pueden mantener el acceso.`}
        confirmLabel="Revocar" destructive busy={busy}
        onConfirm={() => { if (revoking) void respond(revoking, 'revoke') }}
        onCancel={() => setRevoking(null)} />
    </Stack>
  )
}
