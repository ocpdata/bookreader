import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import Snackbar from '@mui/material/Snackbar'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import {
  createFolder,
  deleteFolder,
  deleteSummary,
  listFolders,
  listSummaries,
  listTags,
  restoreSummary,
  setFavorite,
  updateFolder,
} from '../api'
import { childrenOf, pathLabel, pathOf, subtreeIds, totalCount } from '../folders'
import type { SelectableCategory, Folder, SortOption, StatusFilter, Summary, TagSuggestion } from '../types'
import CategoriesDialog from './CategoriesDialog'
import ConfirmDialog from './ConfirmDialog'
import FolderCard from './FolderCard'
import FolderDialog from './FolderDialog'
import MoveToFolderDialog from './MoveToFolderDialog'
import SummaryCard from './SummaryCard'

const SORTS: { value: SortOption; label: string }[] = [
  { value: 'recent', label: 'Más recientes' },
  { value: 'listened', label: 'Última escucha' },
  { value: 'title', label: 'Título (A–Z)' },
  { value: 'duration', label: 'Más largos' },
]

const STATUSES: { value: StatusFilter | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'unfinished', label: 'Pendientes' },
  { value: 'finished', label: 'Terminados' },
]

const VIEW_KEY = 'bookreader.libraryView'

interface Props {
  categories: SelectableCategory[]
  categoriesReady: boolean
  onCreateCategory: (name: string) => Promise<SelectableCategory>
  onDeleteCategory: (id: string) => Promise<void>
}

export default function LibraryView({ categories, categoriesReady, onCreateCategory, onDeleteCategory }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  // Filtros y orden viven en la URL: el botón "atrás" vuelve a la misma búsqueda.
  const [params, setParams] = useSearchParams()
  const categoryId = params.get('categoria') ?? ''
  const tag = params.get('etiqueta') ?? ''
  const folderParam = params.get('carpeta') ?? ''
  const favorite = params.get('favoritos') === '1'
  const status = (STATUSES.some((s) => s.value === params.get('estado')) ? params.get('estado') : '') as StatusFilter | ''
  const sort = (SORTS.some((s) => s.value === params.get('orden')) ? params.get('orden') : 'recent') as SortOption

  const [search, setSearch] = useState(params.get('q') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(search.trim())
  const hasFilters = Boolean(debouncedSearch || categoryId || tag || favorite || status)
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [tags, setTags] = useState<TagSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toDelete, setToDelete] = useState<Summary | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Último audio movido a la papelera, para ofrecer "Deshacer" (también cuando se eliminó desde la ficha).
  const [trashed, setTrashed] = useState<{ id: string; title: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [folders, setFolders] = useState<Folder[]>([])
  const [foldersLoaded, setFoldersLoaded] = useState(false)
  const [folderDialog, setFolderDialog] = useState<{ folder: Folder | null } | null>(null)
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null)
  const [toMove, setToMove] = useState<Summary | null>(null)
  const [notice, setNotice] = useState('')
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [view, setView] = useState<'list' | 'grid'>(() => localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list')

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  const updateParams = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  useEffect(() => {
    const fromDetail = (location.state as { trashed?: { id: string; title: string } } | null)?.trashed
    if (!fromDetail) return
    setTrashed(fromDetail)
    // Se limpia el estado para que no reaparezca al recargar.
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if ((params.get('q') ?? '') !== debouncedSearch) updateParams({ q: debouncedSearch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  useEffect(() => {
    listFolders()
      .then((items) => {
        setFolders(items)
        setFoldersLoaded(true)
      })
      .catch((e: Error) => setError(e.message))
  }, [reloadKey])

  // Una carpeta de la URL que ya no existe (borrada) vuelve a la raíz.
  const currentId = folders.some((f) => f.id === folderParam) ? folderParam : ''
  useEffect(() => {
    if (foldersLoaded && folderParam && !currentId) updateParams({ carpeta: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldersLoaded, folderParam, currentId])

  useEffect(() => {
    listTags()
      .then(setTags)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Sin filtros se navega por carpetas; con búsqueda o filtros se mira toda la biblioteca.
    listSummaries({ search: debouncedSearch, categoryId, tag, favorite, status, sort }, hasFilters ? undefined : folderParam || 'root')
      .then((items) => {
        if (cancelled) return
        setSummaries(items)
        setError('')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [debouncedSearch, categoryId, tag, favorite, status, sort, folderParam, reloadKey, hasFilters])

  async function toggleFavorite(summary: Summary) {
    const value = !summary.favorite
    // Actualización inmediata; si falla se revierte. Con el filtro de favoritos activo, sale de la lista.
    const apply = (favoriteValue: boolean) =>
      setSummaries((items) =>
        items
          .map((s) => (s.id === summary.id ? { ...s, favorite: favoriteValue } : s))
          .filter((s) => !(favorite && !s.favorite)),
      )
    apply(value)
    try {
      await setFavorite(summary.id, value)
    } catch (e) {
      setError((e as Error).message)
      setSummaries((items) => (items.some((s) => s.id === summary.id) ? items.map((s) => (s.id === summary.id ? { ...s, favorite: !value } : s)) : [...items, { ...summary, favorite: !value }]))
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    try {
      await deleteSummary(toDelete.id)
      setSummaries((items) => items.filter((s) => s.id !== toDelete.id))
      setTrashed({ id: toDelete.id, title: toDelete.title })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeleting(false)
      setToDelete(null)
    }
  }

  async function undoDelete() {
    if (!trashed) return
    try {
      await restoreSummary(trashed.id)
      setTrashed(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const browsing = !hasFilters
  const subfolders = childrenOf(folders, currentId || null)
  const current = folders.find((f) => f.id === currentId)

  const openFolder = (id: string) => {
    const next = new URLSearchParams()
    if (id) next.set('carpeta', id)
    if (sort !== 'recent') next.set('orden', sort)
    setSearch('')
    setParams(next)
  }

  async function saveFolder(name: string, parentId: string | null) {
    const editing = folderDialog?.folder
    if (editing) await updateFolder(editing.id, { name, parentId })
    else await createFolder(name, parentId)
    setFolderDialog(null)
    setReloadKey((k) => k + 1)
  }

  async function confirmDeleteFolder() {
    if (!folderToDelete) return
    setDeleting(true)
    try {
      await deleteFolder(folderToDelete.id)
      setNotice(`Carpeta «${folderToDelete.name}» eliminada. Su contenido se conservó.`)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeleting(false)
      setFolderToDelete(null)
    }
  }

  function afterMove(summary: Summary, folderId: string | null) {
    setToMove(null)
    setNotice(`«${summary.title}» se movió a ${folderId ? pathLabel(folders, folderId) : 'la raíz'}`)
    setReloadKey((k) => k + 1)
  }

  const deleteMessage = folderToDelete
    ? (() => {
        const audios = totalCount(folders, folderToDelete.id)
        const subs = subtreeIds(folders, folderToDelete.id).size - 1
        const parent = folderToDelete.parentId ? `«${pathLabel(folders, folderToDelete.parentId)}»` : 'la raíz'
        const content = [
          `${audios} ${audios === 1 ? 'audio' : 'audios'}`,
          `${subs} ${subs === 1 ? 'subcarpeta' : 'subcarpetas'}`,
        ].join(' y ')
        return `Su contenido (${content}) pasará a ${parent}. No se borra ningún audio.`
      })()
    : ''

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="overline" sx={{ color: 'primary.dark', fontWeight: 700, letterSpacing: '0.12em' }}>Tu espacio de escucha</Typography>
          <Typography variant="h5" component="h1">
            {browsing && current ? current.name : 'Mi biblioteca'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Tus libros e ideas, en un solo lugar.</Typography>
        </Box>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button disabled={!categoriesReady} onClick={() => setCategoriesOpen(true)}>Categorías</Button>
          <Button onClick={() => setFolderDialog({ folder: null })}>+ Nueva carpeta</Button>
          <Button variant="contained" onClick={() => navigate(`/audios/nuevo${currentId ? `?carpeta=${currentId}` : ''}`)}>
            + Agregar resumen
          </Button>
        </Stack>
        <CategoriesDialog open={categoriesOpen} categories={categories} onCreate={onCreateCategory}
          onDelete={onDeleteCategory} onClose={() => setCategoriesOpen(false)}
          onDeleted={(id) => { if (categoryId === id) updateParams({ categoria: '' }) }} />
      </Stack>

      {browsing && currentId && (
        <Breadcrumbs aria-label="Ruta de carpetas">
          <Link component="button" underline="hover" onClick={() => openFolder('')}>
            Biblioteca
          </Link>
          {pathOf(folders, currentId).map((f, i, all) =>
            i === all.length - 1 ? (
              <Typography key={f.id} color="text.primary">
                {f.name}
              </Typography>
            ) : (
              <Link key={f.id} component="button" underline="hover" onClick={() => openFolder(f.id)}>
                {f.name}
              </Link>
            ),
          )}
        </Breadcrumbs>
      )}

      <TextField
        label="Buscar por título, autor o etiqueta"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
        size="small"
      />
      <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleButton
          value="favoritos"
          size="small"
          selected={favorite}
          onChange={() => updateParams({ favoritos: favorite ? '' : '1' })}
          aria-label="Solo favoritos"
        >
          {favorite ? '★' : '☆'} Favoritos
        </ToggleButton>
        <TextField
          select
          label="Categoría"
          value={categoryId}
          onChange={(e) => updateParams({ categoria: e.target.value })}
          size="small"
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="">Todas</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Etiqueta"
          value={tag}
          onChange={(e) => updateParams({ etiqueta: e.target.value })}
          size="small"
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">Todas</MenuItem>
          {tag && !tags.some((t) => t.name.toLowerCase() === tag.toLowerCase()) && (
            <MenuItem value={tag}>{tag}</MenuItem>
          )}
          {tags.map((t) => (
            <MenuItem key={t.name} value={t.name}>
              {t.name} ({t.count})
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Estado"
          value={status}
          onChange={(e) => updateParams({ estado: e.target.value })}
          size="small"
          sx={{ minWidth: 140 }}
        >
          {STATUSES.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Ordenar por"
          value={sort}
          onChange={(e) => updateParams({ orden: e.target.value === 'recent' ? '' : e.target.value })}
          size="small"
          sx={{ minWidth: 160 }}
        >
          {SORTS.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <ToggleButtonGroup
          value={view}
          exclusive
          size="small"
          aria-label="Vista de la biblioteca"
          onChange={(_, next: 'list' | 'grid' | null) => { if (next) setView(next) }}
          sx={{ ml: { md: 'auto' }, bgcolor: 'background.paper' }}
        >
          <ToggleButton value="list" aria-label="Vista de lista">☰ Lista</ToggleButton>
          <ToggleButton value="grid" aria-label="Vista de cuadrícula">▦ Cuadrícula</ToggleButton>
        </ToggleButtonGroup>
        {hasFilters && (
          <Button
            size="small"
            onClick={() => {
              setSearch('')
              const next = new URLSearchParams()
              if (folderParam) next.set('carpeta', folderParam)
              if (sort !== 'recent') next.set('orden', sort)
              setParams(next, { replace: true })
            }}
          >
            Limpiar filtros
          </Button>
        )}
      </Stack>
      {hasFilters && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }} aria-label="Filtros activos">
          <Typography variant="body2" color="text.secondary">Filtros:</Typography>
          {debouncedSearch && <Chip size="small" aria-label={`Quitar filtro de búsqueda: ${debouncedSearch}`} label={`Búsqueda: ${debouncedSearch}`} onDelete={() => { setSearch(''); updateParams({ q: '' }) }} />}
          {favorite && <Chip size="small" aria-label="Quitar filtro de favoritos" label="Favoritos" onDelete={() => updateParams({ favoritos: '' })} />}
          {categoryId && <Chip size="small" aria-label="Quitar filtro de categoría" label={`Categoría: ${categories.find((c) => c.id === categoryId)?.name ?? 'seleccionada'}`} onDelete={() => updateParams({ categoria: '' })} />}
          {tag && <Chip size="small" aria-label={`Quitar filtro de etiqueta: ${tag}`} label={`Etiqueta: ${tag}`} onDelete={() => updateParams({ etiqueta: '' })} />}
          {status && <Chip size="small" aria-label="Quitar filtro de estado" label={`Estado: ${STATUSES.find((s) => s.value === status)?.label ?? status}`} onDelete={() => updateParams({ estado: '' })} />}
        </Stack>
      )}

      {error && <Alert severity="error">{error}</Alert>}
      {loading && (
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      )}
      {hasFilters && folders.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          Buscando en toda la biblioteca, sin importar la carpeta.
        </Typography>
      )}
      {browsing &&
        subfolders.map((f) => (
          <FolderCard
            key={f.id}
            folder={f}
            total={totalCount(folders, f.id)}
            subfolders={subtreeIds(folders, f.id).size - 1}
            onOpen={(folder) => openFolder(folder.id)}
            onEdit={(folder) => setFolderDialog({ folder })}
            onDelete={setFolderToDelete}
          />
        ))}
      {!loading && !error && summaries.length === 0 && (browsing ? subfolders.length === 0 : true) && (
        <Typography color="text.secondary">
          {browsing && current ? 'Esta carpeta está vacía.' : 'No hay resúmenes que mostrar.'}
        </Typography>
      )}

      <Box sx={{ display: view === 'grid' ? 'grid' : 'flex', flexDirection: 'column',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))', gap: 2 }}>
        {summaries.map((s) => (
          <SummaryCard
            key={s.id}
            summary={s}
            grid={view === 'grid'}
            activeTag={tag}
            onToggleFavorite={toggleFavorite}
            onTagClick={(name) => updateParams({ etiqueta: name })}
            onDelete={setToDelete}
            onMove={setToMove}
            folderPath={hasFilters && s.folderId ? pathLabel(folders, s.folderId) : undefined}
            onFolderClick={(summary) => openFolder(summary.folderId ?? '')}
          />
        ))}
      </Box>

      <ConfirmDialog
        open={toDelete !== null}
        title="¿Mover a la papelera?"
        message={`«${toDelete?.title ?? ''}» se moverá a la papelera. Podrás restaurarlo durante 30 días.`}
        confirmLabel="Mover a la papelera"
        destructive
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
      <FolderDialog
        open={folderDialog !== null}
        folders={folders}
        folder={folderDialog?.folder}
        defaultParentId={currentId}
        onSubmit={saveFolder}
        onClose={() => setFolderDialog(null)}
      />
      <ConfirmDialog
        open={folderToDelete !== null}
        title={`¿Eliminar la carpeta «${folderToDelete?.name ?? ''}»?`}
        message={deleteMessage}
        confirmLabel="Eliminar carpeta"
        busy={deleting}
        onConfirm={confirmDeleteFolder}
        onCancel={() => setFolderToDelete(null)}
      />
      <MoveToFolderDialog summary={toMove} folders={folders} onMoved={afterMove} onClose={() => setToMove(null)} />
      <Snackbar open={notice !== ''} autoHideDuration={6000} onClose={() => setNotice('')} message={notice} />
      <Snackbar
        open={trashed !== null}
        autoHideDuration={8000}
        onClose={(_, reason) => reason !== 'clickaway' && setTrashed(null)}
        message={trashed ? `«${trashed.title}» se movió a la papelera` : ''}
        action={
          <Button color="inherit" size="small" onClick={undoDelete}>
            Deshacer
          </Button>
        }
      />
    </Stack>
  )
}
