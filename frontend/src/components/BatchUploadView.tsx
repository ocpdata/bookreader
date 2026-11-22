import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  audioContentType, beginBatchItem, cancelPendingUpload, findDuplicates, finishBatchItem,
  getUsage, importDriveFile, inspectDriveFile, listFolders, MAX_AUDIO_BYTES,
  type DriveSelection, type DuplicateMatch, type Usage,
} from '../api'
import { useAuth } from '../auth'
import { formatBytes } from '../format'
import { driveConfigured, prepareDrive, revokeDrive, selectDriveFiles } from '../googleDrive'
import type { Folder, SelectableCategory, SummaryFields } from '../types'
import FolderSelect from './FolderSelect'

type Status = 'ready' | 'uploading' | 'failed' | 'completed' | 'cancelled'

interface Item {
  key: string
  name: string
  size: number
  hash: string
  title: string
  author: string
  categoryId: string
  folderId: string
  status: Status
  started: boolean
  summaryId?: string
  error?: string
  matches: DuplicateMatch[]
  unchecked: number
  truncated: boolean
  reviewed: boolean
  accepted: boolean
  source?: 'drive'
  driveFileId?: string
}

type DriveAttachment = DriveSelection & { version: string }

function isItem(value: unknown): value is Item {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.key === 'string' && typeof item.name === 'string' && typeof item.size === 'number' &&
    typeof item.hash === 'string' && typeof item.title === 'string' && typeof item.author === 'string' &&
    typeof item.categoryId === 'string' && typeof item.folderId === 'string' &&
    ['ready', 'uploading', 'failed', 'completed', 'cancelled'].includes(String(item.status)) &&
    typeof item.started === 'boolean' && Array.isArray(item.matches) &&
    (item.source === undefined || (item.source === 'drive' && typeof item.driveFileId === 'string'))
}

async function fileHash(file: File) {
  if (!globalThis.crypto?.subtle) throw new Error('El navegador no permite calcular la huella; usa una conexión segura HTTPS.')
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function loadSaved(key: string): { items: Item[]; error: string } {
  try {
    const raw = localStorage.getItem(key)
    const saved: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(saved) || !saved.every(isItem)) throw new Error('El lote guardado no es válido')
    return {
      // Los completados ya están en la biblioteca: se descartan al entrar. Fallidos y pendientes se conservan para retomarlos.
      items: saved
        .filter((item) => item.status !== 'completed')
        .map((item) => item.status === 'uploading'
          ? { ...item, status: 'failed' as const, error: 'La carga se interrumpió. Selecciona de nuevo el archivo y reintenta.' }
          : item),
      error: '',
    }
  } catch (e) {
    return { items: [], error: `No se pudo recuperar el lote: ${(e as Error).message}` }
  }
}

function itemFields(item: Item): SummaryFields {
  return {
    title: item.title.trim(), author: item.author.trim(), categoryId: item.categoryId,
    folderId: item.folderId || null, summaryTitle: '', narrator: '', description: '', tags: [],
  }
}

export default function BatchUploadView({ categories }: { categories: SelectableCategory[] }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const storageKey = `bookreader.batchUpload.${user?.id ?? ''}`
  const [saved] = useState(() => loadSaved(storageKey))
  const [items, setItems] = useState<Item[]>(saved.items)
  const itemsRef = useRef<Item[]>(saved.items)
  const files = useRef(new Map<string, File>())
  const driveFiles = useRef(new Map<string, DriveAttachment>())
  const driveTokens = useRef(new Set<string>())
  const [attached, setAttached] = useState<Set<string>>(new Set())
  const [driveReady, setDriveReady] = useState(false)
  const [driveConnected, setDriveConnected] = useState(false)
  const mounted = useRef(true)
  const [folders, setFolders] = useState<Folder[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [category, setCategory] = useState('')
  const [folder, setFolder] = useState(params.get('carpeta') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(saved.error)
  const loaded = !saved.error

  function save(next: Item[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      throw new Error('No se pudo guardar el estado del lote en este navegador. No se inició la carga.')
    }
    itemsRef.current = next
    setItems(next)
  }

  function update(key: string, changes: Partial<Item>) {
    save(itemsRef.current.map((item) => item.key === key ? { ...item, ...changes } : item))
  }

  useEffect(() => {
    listFolders().then(setFolders).catch((e: Error) => setError(e.message))
    getUsage().then(setUsage).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  async function selectFiles(selected: File[]) {
    setBusy(true)
    setError('')
    try {
      for (const file of selected) {
        if (!audioContentType(file.name)) throw new Error(`${file.name}: el archivo debe ser MP3 o M4A`)
        if (!file.size || file.size > MAX_AUDIO_BYTES) throw new Error(`${file.name}: el tamaño debe ser mayor que cero y no superar 200 MB`)
        const hash = await fileHash(file)
        if (!mounted.current) return
        const awaitingFile = itemsRef.current.find((item) =>
          item.status !== 'completed' && item.status !== 'cancelled' && !files.current.has(item.key) &&
          item.source !== 'drive' && item.name === file.name)
        if (awaitingFile) {
          if (awaitingFile.hash !== hash || awaitingFile.size !== file.size) {
            throw new Error(`${file.name}: el contenido no coincide con el archivo pendiente.`)
          }
          files.current.set(awaitingFile.key, file)
          setAttached((current) => new Set(current).add(awaitingFile.key))
          continue
        }
        const item: Item = {
          key: crypto.randomUUID(), name: file.name, size: file.size, hash,
          title: file.name.replace(/\.(mp3|m4a)$/i, '').slice(0, 200), author: '', categoryId: category,
          folderId: folder, status: 'ready', started: false, matches: [], unchecked: 0, truncated: false, reviewed: false, accepted: false,
        }
        files.current.set(item.key, file)
        save([...itemsRef.current, item])
        setAttached((current) => new Set(current).add(item.key))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function prepareGoogleDrive() {
    setError('')
    setBusy(true)
    try {
      await prepareDrive()
      if (mounted.current) setDriveReady(true)
    } catch (e) {
      if (mounted.current) setError((e as Error).message)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function selectGoogleFiles() {
    setError('')
    setBusy(true)
    try {
      const selected = await selectDriveFiles()
      if (!selected || !mounted.current) return
      driveTokens.current.add(selected.token)
      setDriveConnected(true)
      for (const document of selected.files) {
        const selection: DriveSelection = {
          fileId: document.id, accessToken: selected.token,
          ...(document.resourceKey ? { resourceKey: document.resourceKey } : {}),
        }
        const file = await inspectDriveFile(selection)
        if (!mounted.current) return
        const awaiting = itemsRef.current.find((item) =>
          item.source === 'drive' && item.driveFileId === file.id &&
          item.status !== 'completed' && item.status !== 'cancelled')
        if (awaiting) {
          if (awaiting.hash !== file.sha256 || awaiting.size !== file.size || awaiting.name !== file.name) {
            throw new Error(`${file.name}: el contenido cambió. Cancela u omite la carga anterior y selecciónalo de nuevo.`)
          }
          driveFiles.current.set(awaiting.key, { ...selection, version: file.version })
          update(awaiting.key, { reviewed: false, accepted: false })
          setAttached((current) => new Set(current).add(awaiting.key))
          continue
        }
        const item: Item = {
          key: crypto.randomUUID(), name: file.name, size: file.size, hash: file.sha256,
          title: file.name.replace(/\.(mp3|m4a)$/i, '').slice(0, 200), author: '', categoryId: category,
          folderId: folder, status: 'ready', started: false, matches: [], unchecked: 0, truncated: false,
          reviewed: false, accepted: false, source: 'drive', driveFileId: file.id,
        }
        driveFiles.current.set(item.key, { ...selection, version: file.version })
        save([...itemsRef.current, item])
        setAttached((current) => new Set(current).add(item.key))
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function disconnectDrive() {
    const tokens = [...driveTokens.current]
    if (!tokens.length) return
    setBusy(true)
    setError('')
    try {
      const results = await Promise.allSettled(tokens.map(revokeDrive))
      driveTokens.current.clear()
      const keys = new Set(driveFiles.current.keys())
      driveFiles.current.clear()
      setAttached((current) => new Set([...current].filter((key) => !keys.has(key))))
      setDriveConnected(false)
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('No se pudo revocar todo el acceso de Google Drive. Puedes hacerlo desde tu cuenta de Google.')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function review() {
    setError('')
    setBusy(true)
    try {
      for (const item of itemsRef.current.filter((entry) => entry.status !== 'completed' && entry.status !== 'cancelled')) {
        if (!item.title.trim() || !item.author.trim() || !item.categoryId) {
          throw new Error(`Completa título, autor y categoría para ${item.name}.`)
        }
        const result = await findDuplicates(item.hash, item.title.trim(), item.author.trim(), item.key)
        if (!mounted.current) return
        update(item.key, { matches: result.matches, unchecked: result.unchecked, truncated: result.truncated, reviewed: true, accepted: false })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function localDuplicates(item: Item) {
    return items.filter((other) => other.key !== item.key && other.status !== 'cancelled' &&
      (other.hash === item.hash || (other.title.trim().toLocaleLowerCase() === item.title.trim().toLocaleLowerCase() &&
        other.author.trim().toLocaleLowerCase() === item.author.trim().toLocaleLowerCase() && Boolean(item.author.trim()))))
  }

  async function start() {
    setError('')
    const pending = itemsRef.current.filter((item) => item.status === 'ready' || item.status === 'failed')
    if (!pending.length) return setError('No hay archivos pendientes.')
    for (const item of pending) {
      if (item.source === 'drive' ? !driveFiles.current.has(item.key) : !files.current.has(item.key)) {
        return setError(`Selecciona de nuevo ${item.name} para continuar.`)
      }
      if (!item.reviewed) return setError('Comprueba los duplicados antes de subir.')
      if ((item.matches.length || localDuplicates(item).length) && !item.accepted) {
        return setError(`Revisa y confirma las coincidencias de ${item.name}.`)
      }
    }
    setBusy(true)
    try {
      const currentUsage = await getUsage()
      if (!mounted.current) return
      setUsage(currentUsage)
      const unstarted = pending.filter((item) => !item.started)
      if (currentUsage.audios + unstarted.length > currentUsage.maxAudios) throw new Error('El lote supera el número de audios disponible.')
      if (unstarted.reduce((sum, item) => sum + item.size, 0) > currentUsage.limitBytes - currentUsage.usedBytes) {
        throw new Error('El lote supera el espacio disponible.')
      }
      for (const item of pending) {
        try {
          update(item.key, { started: true, status: 'uploading', error: undefined })
          const result = await beginBatchItem(itemFields(item), item, item.key, item.hash)
          if (!mounted.current) break
          update(item.key, { summaryId: result.summary.id })
          if (result.upload) {
            if (item.source === 'drive') {
              const drive = driveFiles.current.get(item.key)!
              await importDriveFile(result.summary.id, drive, drive.version)
            } else {
              await finishBatchItem(result.summary, result.upload, files.current.get(item.key)!)
            }
          }
          if (!mounted.current) break
          update(item.key, { status: 'completed', error: undefined })
        } catch (e) {
          if (!mounted.current) break
          update(item.key, { status: 'failed', error: (e as Error).message })
          break
        }
      }
      if (mounted.current) setUsage(await getUsage())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel(item: Item) {
    setBusy(true)
    setError('')
    try {
      let summaryId = item.summaryId
      if (item.started && !summaryId) {
        const result = await beginBatchItem(itemFields(item), item, item.key, item.hash)
        if (!mounted.current) return
        summaryId = result.summary.id
        update(item.key, { summaryId })
        if (result.summary.status === 'READY') {
          update(item.key, { status: 'completed', error: undefined })
          setError('El audio ya se había completado y está en la biblioteca.')
          return
        }
      }
      if (summaryId) await cancelPendingUpload(summaryId)
      if (!mounted.current) return
      update(item.key, { status: 'cancelled', error: undefined })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function edit(item: Item, changes: Partial<Item>) {
    try {
      update(item.key, { ...changes, reviewed: false, accepted: false })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">Subir varios audios</Typography>
      <Typography color="text.secondary">
        Cada archivo crea un resumen. Si sales, vuelve a seleccionar los archivos pendientes para continuar.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {usage && <Typography variant="body2">Disponibles: {Math.max(0, usage.maxAudios - usage.audios)} audios y {formatBytes(Math.max(0, usage.limitBytes - usage.usedBytes))}.</Typography>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField select label="Categoría común" value={category} onChange={(e) => setCategory(e.target.value)} fullWidth disabled={busy}>
          {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
        <FolderSelect folders={folders} value={folder} onChange={setFolder} label="Carpeta común" disabled={busy} />
        <Button disabled={busy || !loaded} onClick={() => {
          try {
            save(itemsRef.current.map((item) => item.started ? item : {
              ...item, categoryId: category, folderId: folder, reviewed: false, accepted: false,
            }))
          } catch (e) { setError((e as Error).message) }
        }}>Aplicar</Button>
      </Stack>
      <Button component="label" variant="outlined" disabled={busy || !loaded}>
        Seleccionar archivos MP3 o M4A
        <input type="file" hidden multiple accept=".mp3,.m4a,audio/mpeg,audio/mp4" onChange={(e) => {
          void selectFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }} />
      </Button>
      {driveConfigured && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {!driveReady
            ? <Button variant="outlined" disabled={busy || !loaded} onClick={() => void prepareGoogleDrive()}>Preparar Google Drive</Button>
            : <Button variant="outlined" disabled={busy || !loaded} onClick={() => void selectGoogleFiles()}>Seleccionar archivos de Google Drive</Button>}
          {driveConnected && <Button disabled={busy} onClick={() => void disconnectDrive()}>Desconectar Google Drive</Button>}
        </Stack>
      )}
      {driveConfigured && <Typography variant="body2" color="text.secondary">
        Al importar desde Drive se crea una copia independiente que consume tu cuota. Mantén esta página abierta durante el proceso.
      </Typography>}
      {items.map((item) => {
        const local = localDuplicates(item)
        const frozen = busy || item.started || item.status === 'cancelled' || item.status === 'completed'
        return (
          <Paper key={item.key} variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>{item.name} · {formatBytes(item.size)}{item.source === 'drive' ? ' · Google Drive' : ''}</Typography>
              <TextField label="Título del libro" value={item.title} disabled={frozen} fullWidth
                onChange={(e) => edit(item, { title: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
              <TextField label="Autor del libro" value={item.author} disabled={frozen} fullWidth
                onChange={(e) => edit(item, { author: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
              <TextField select label="Categoría" value={item.categoryId} disabled={frozen} fullWidth
                onChange={(e) => edit(item, { categoryId: e.target.value })}>
                {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <FolderSelect folders={folders} value={item.folderId} label="Carpeta" disabled={frozen}
                onChange={(folderId) => edit(item, { folderId })} />
              {item.unchecked > 0 && item.reviewed && <Alert severity="info">La comprobación exacta está incompleta: {item.unchecked} audios aún no tienen huella.</Alert>}
              {item.truncated && item.reviewed && <Alert severity="info">Se muestran las primeras 50 coincidencias.</Alert>}
              {item.reviewed && item.matches.length === 0 && local.length === 0 && item.status !== 'completed' && item.status !== 'cancelled' && (
                <Alert severity="success">Sin coincidencias: no hay duplicados de este audio.</Alert>
              )}
              {item.reviewed && (item.matches.length > 0 || local.length > 0) && (
                <Alert severity="warning">
                  {item.matches.map((match) => (
                    <Typography key={match.id} variant="body2">
                      {match.exact ? 'Archivo idéntico' : 'Posible duplicado'}: {match.title} — {match.author}
                      {match.inTrash ? ' (papelera)' : match.pending ? ' (carga pendiente)' : ''}
                    </Typography>
                  ))}
                  {local.map((match) => <Typography key={match.key} variant="body2">{match.hash === item.hash ? 'Archivo idéntico' : 'Posible duplicado'} en este lote: {match.name}</Typography>)}
                  <FormControlLabel control={<Checkbox checked={item.accepted} disabled={busy} onChange={(e) => {
                    try { update(item.key, { accepted: e.target.checked }) } catch (err) { setError((err as Error).message) }
                  }} />} label="Quiero subirlo de todos modos" />
                </Alert>
              )}
              <Typography variant="body2">
                Estado: {{ ready: 'Preparado', uploading: 'Subiendo y verificando', failed: 'Falló; se puede reintentar', completed: 'Completado', cancelled: 'Cancelado' }[item.status]}
                {!attached.has(item.key) && item.status !== 'completed' && item.status !== 'cancelled'
                  ? item.source === 'drive' ? ' · Selecciona el archivo de nuevo en Google Drive' : ' · Selecciona el archivo de nuevo'
                  : ''}
              </Typography>
              {item.error && <Alert severity="error">{item.error}</Alert>}
              {item.status !== 'completed' && item.status !== 'cancelled' && (
                <Button size="small" disabled={busy} onClick={() => void cancel(item)} sx={{ alignSelf: 'flex-start' }}>
                  {item.started ? 'Cancelar carga' : 'Omitir archivo'}
                </Button>
              )}
            </Stack>
          </Paper>
        )
      })}
      {items.some((item) => item.status === 'cancelled' && item.started) && (
        <Alert severity="info">Las cargas canceladas conservan su reserva hasta la limpieza de pendientes; puede tardar más de 24 horas y requiere que la limpieza esté habilitada.</Alert>
      )}
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" disabled={busy || !items.length} onClick={() => void review()}>Comprobar duplicados</Button>
        <Button variant="contained" disabled={busy || !items.length} onClick={() => void start()}>Subir pendientes</Button>
        <Button disabled={busy || !items.length || items.some((item) => item.status !== 'completed' && item.status !== 'cancelled')}
          onClick={() => {
            try { save([]); files.current.clear(); driveFiles.current.clear(); setAttached(new Set()) } catch (e) { setError((e as Error).message) }
          }}>Limpiar lote terminado</Button>
        <Button disabled={busy} onClick={() => navigate('/biblioteca')}>Volver a la biblioteca</Button>
      </Stack>
      {busy && <Alert severity="info">Procesando archivos. No cierres esta página.</Alert>}
    </Stack>
  )
}
