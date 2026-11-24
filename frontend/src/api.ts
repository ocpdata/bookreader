import type {
  SelectableCategory,
  Folder,
  HomeData,
  LibraryFilters,
  Progress,
  Summary,
  SummaryFields,
  TagSuggestion,
  TrashItem,
} from './types'

const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
}

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024

export function audioContentType(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return AUDIO_TYPES[ext] ?? null
}

// Cuando el servidor responde 401 en cualquier llamada, la sesión terminó: se avisa para volver al acceso.
let unauthorizedHandler: (() => void) | null = null
export const onUnauthorized = (handler: (() => void) | null) => {
  unauthorizedHandler = handler
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      // Con FormData el navegador pone el Content-Type (con el boundary).
      headers: init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    })
  } catch {
    throw new Error('No se pudo conectar con el servidor. ¿Está corriendo el backend?')
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) unauthorizedHandler?.()
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message
    throw new Error(message ?? `Error ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Guardados de progreso en vuelo. Las lecturas los esperan: al volver a la lista justo después de
// escuchar (el guardado final sale al desmontar el reproductor), se ve la posición ya guardada.
const pendingSaves = new Set<Promise<unknown>>()

function track<T>(promise: Promise<T>): Promise<T> {
  const done = () => void pendingSaves.delete(promise)
  pendingSaves.add(promise)
  promise.then(done, done)
  return promise
}

const settlePendingSaves = () => Promise.allSettled([...pendingSaves])

export interface CurrentUser {
  id: string
  name: string
  email: string | null
  /** true si todavía no aceptó la versión vigente de los términos y del aviso de privacidad. */
  needsTerms: boolean
  role: 'USER' | 'ADMIN'
  isOwner: boolean
}

export interface AdminUser {
  id: string
  name: string
  email: string | null
  role: 'USER' | 'ADMIN'
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED'
  isOwner: boolean
}

export const listAdminUsers = (page: number) =>
  request<{ users: AdminUser[]; page: number; pageSize: number; total: number }>(`/admin/users?page=${page}`)

export const changeUserRole = (id: string, role: AdminUser['role'], password: string) =>
  request<{ id: string; role: AdminUser['role'] }>(`/admin/users/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role, password }),
  })

export type StatisticsPeriod = 'today' | 'week' | 'month'

export interface PersonalStatistics {
  saved: number
  inProgress: number
  finished: number
  favorites: number
  storageBytes: number
  storageAudios: number
  durationMs: number
  days: { date: string; durationMs: number }[]
  titles: { id: string; title: string; durationMs: number }[]
}

export const recordListening = (event: { id: string; summaryId: string; durationMs: number }, keepalive = false) =>
  request<void>('/statistics/listening', { method: 'POST', body: JSON.stringify(event), keepalive })

export const getMyStatistics = (period: StatisticsPeriod) =>
  request<PersonalStatistics>(`/statistics/me?period=${period}`)

export const getAdminStatistics = (period: StatisticsPeriod) =>
  request<{ registered: number; activeListeners: number; durationMs: number }>(`/statistics/admin?period=${period}`)

export const getUserStatistics = (id: string, period: StatisticsPeriod) =>
  request<{ user: { id: string; name: string; email: string | null; lastLoginAt: string | null }; statistics: PersonalStatistics }>(
    `/statistics/admin/users/${encodeURIComponent(id)}?period=${period}`,
  )

export const acceptTerms = () => request<CurrentUser>('/auth/accept-terms', { method: 'POST' })

/** Elimina la cuenta y todo su contenido; la contraseña mala es un 400 (no cierra la sesión). */
export const deleteAccount = (password: string) =>
  request<void>('/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) })

export const login = (email: string, password: string) =>
  request<CurrentUser>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })

export const logout = () => request<void>('/auth/logout', { method: 'POST' })

export const getMe = () => request<CurrentUser>('/auth/me')

export const getMobileConfig = () => request<{ enabled: boolean; serverUrl: string | null }>('/auth/mobile-config')

export type RegistrationMode = 'closed' | 'invite' | 'open'

export const getAuthConfig = () => request<{ registration: RegistrationMode }>('/auth/config')

export interface RegisterFields {
  email: string
  name: string
  password: string
  inviteCode?: string
  acceptTerms: boolean
}

export const registerAccount = (fields: RegisterFields) =>
  request<{ message: string }>('/auth/register', { method: 'POST', body: JSON.stringify(fields) })

export const resendVerification = (email: string) =>
  request<{ message: string }>('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) })

export const verifyEmail = (token: string) =>
  request<{ message: string }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })

export const forgotPassword = (email: string) =>
  request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })

export const resetPassword = (token: string, password: string) =>
  request<{ message: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) })

export const changePassword = (current: string, next: string) =>
  request<void>('/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) })

export interface Usage {
  usedBytes: number
  limitBytes: number
  audios: number
  maxAudios: number
  /** Parte del uso que está en la papelera (cuenta hasta que se elimina de forma definitiva). */
  trashBytes: number
  trashAudios: number
  plan: 'TRIAL' | 'PREMIUM' | 'FOUNDER'
  planExpiresAt: string | null
  /** true cuando la prueba o el plan vencieron: se puede escuchar y borrar, pero no subir. */
  uploadsBlocked: boolean
}

export const getUsage = () => request<Usage>('/usage')

export const getBillingConfig = () => request<{ enabled: boolean }>('/billing/config')

/** Crea la sesión de pago de Stripe y devuelve su URL para redirigir. */
export const startCheckout = (plan: 'monthly' | 'yearly') =>
  request<{ url: string }>('/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) })

/** Portal de Stripe para gestionar o cancelar la suscripción. */
export const openBillingPortal = () => request<{ url: string }>('/billing/portal', { method: 'POST' })

/** Confirma el pago al volver de Stripe (por si el webhook aún no llegó). */
export const confirmCheckout = (sessionId: string) =>
  request<{ plan: 'PREMIUM' | null }>('/billing/confirm', { method: 'POST', body: JSON.stringify({ sessionId }) })

export interface LinkedDevice {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export const listDevices = () => request<LinkedDevice[]>('/auth/devices')

export const revokeDevice = (id: string) => request<void>(`/auth/devices/${id}`, { method: 'DELETE' })

export const revokeAllDevices = () => request<void>('/auth/devices', { method: 'DELETE' })

export const listCategories = () => request<SelectableCategory[]>('/categories')

export const createCategory = (name: string) =>
  request<SelectableCategory>('/categories', { method: 'POST', body: JSON.stringify({ name }) })

export const deleteCategory = (id: string) =>
  request<void>(`/categories/${id}`, { method: 'DELETE' })

/** folderId: id de carpeta, "root" para los audios sin carpeta o undefined para toda la biblioteca. */
export async function listSummaries(
  { search, categoryId, tag, favorite, status, sort }: LibraryFilters,
  folderId?: string,
) {
  await settlePendingSaves()
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (categoryId) params.set('categoryId', categoryId)
  if (tag) params.set('tag', tag)
  if (favorite) params.set('favorite', 'true')
  if (status) params.set('status', status)
  if (folderId) params.set('folderId', folderId)
  params.set('sort', sort)
  return request<Summary[]>(`/summaries?${params}`)
}

export const listFolders = () => request<Folder[]>('/folders')

export const createFolder = (name: string, parentId: string | null) =>
  request<Folder>('/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) })

export const updateFolder = (id: string, changes: { name?: string; parentId?: string | null }) =>
  request<Folder>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(changes) })

export const deleteFolder = (id: string) =>
  request<{ movedFolders: number; movedAudios: number }>(`/folders/${id}`, { method: 'DELETE' })

export const moveSummaries = (ids: string[], folderId: string | null) =>
  request<{ moved: number }>('/summaries/move', { method: 'POST', body: JSON.stringify({ ids, folderId }) })

export const uploadCover = (id: string, image: Blob) => {
  const body = new FormData()
  body.append('file', image, 'portada.jpg')
  return request<Summary>(`/summaries/${id}/cover`, { method: 'POST', body })
}

export const coverFromAudio = (id: string) => request<Summary>(`/summaries/${id}/cover/from-audio`, { method: 'POST' })

export const removeCover = (id: string) => request<void>(`/summaries/${id}/cover`, { method: 'DELETE' })

export const getHome = async () => {
  await settlePendingSaves()
  return request<HomeData>('/home')
}

// Papelera: eliminar mueve el audio a la papelera (recuperable); el borrado definitivo es aparte.
export const deleteSummary = (id: string) => request<void>(`/summaries/${id}`, { method: 'DELETE' })

export const restoreSummary = (id: string) => request<Summary>(`/summaries/${id}/restore`, { method: 'POST' })

export const listTrash = () => request<TrashItem[]>('/trash')

export const deleteForever = (id: string) => request<void>(`/trash/${id}`, { method: 'DELETE' })

export const emptyTrash = () => request<{ deleted: number; failed: number }>('/trash', { method: 'DELETE' })

export const listTags = (query = '') =>
  request<TagSuggestion[]>(`/tags${query ? `?query=${encodeURIComponent(query)}` : ''}`)

export const setFavorite = (id: string, favorite: boolean) =>
  request<unknown>(`/summaries/${id}/favorite`, { method: favorite ? 'PUT' : 'DELETE' })

export const getSummary = async (id: string) => {
  await settlePendingSaves()
  return request<Summary>(`/summaries/${id}`)
}

export const getPlaybackUrl = (id: string) =>
  request<{ url: string }>(`/summaries/${id}/playback`, { method: 'POST' }).then((r) => r.url)

export const saveProgress = (
  id: string,
  body: { positionSeconds?: number; completed?: boolean },
  keepalive = false,
) => track(request<Progress>(`/summaries/${id}/progress`, { method: 'PUT', body: JSON.stringify(body), keepalive }))

export const resetProgress = (id: string) => request<void>(`/summaries/${id}/progress`, { method: 'DELETE' })

export const updateSummary = (id: string, fields: SummaryFields) =>
  request<Summary>(`/summaries/${id}`, { method: 'PATCH', body: JSON.stringify(fields) })

export interface DuplicateMatch {
  id: string
  title: string
  author: string
  exact: boolean
  inTrash: boolean
  pending: boolean
}

export function findDuplicates(sha256: string, title: string, author: string, uploadRequestId: string) {
  const query = new URLSearchParams({ sha256, title, author, uploadRequestId })
  return request<{ matches: DuplicateMatch[]; unchecked: number; truncated: boolean }>(`/summaries/duplicates?${query}`)
}

export const cancelPendingUpload = (id: string) =>
  request<void>(`/summaries/${id}/cancel-upload`, { method: 'POST' })

export interface DriveSelection {
  fileId: string
  accessToken: string
  resourceKey?: string
}

export const inspectDriveFile = (selection: DriveSelection) =>
  request<{ id: string; name: string; size: number; version: string; sha256: string }>('/summaries/drive/inspect', {
    method: 'POST', body: JSON.stringify(selection),
  })

export const importDriveFile = (id: string, selection: DriveSelection) =>
  request<Summary>(`/summaries/${id}/drive-import`, {
    method: 'POST', body: JSON.stringify(selection),
  })

export async function beginBatchItem(fields: SummaryFields, file: { name: string; size: number }, uploadRequestId: string, requestedSha256: string) {
  const contentType = audioContentType(file.name)
  if (!contentType) throw new Error('El archivo debe ser MP3 o M4A')
  return request<{
    summary: Summary
    upload: { url: string; headers: Record<string, string> } | null
  }>('/summaries', {
    method: 'POST',
    body: JSON.stringify({ ...fields, uploadRequestId, requestedSha256, originalFilename: file.name, contentType, sizeBytes: file.size }),
  })
}

export async function finishBatchItem(summary: Summary, upload: { url: string; headers: Record<string, string> }, file: File): Promise<Summary> {
  let response: Response
  try {
    response = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file })
  } catch {
    throw new Error('No se pudo subir el archivo. Comprueba tu conexión y reintenta.')
  }
  if (!response.ok) throw new Error(`S3 rechazó la carga (HTTP ${response.status})`)
  return request<Summary>(`/summaries/${summary.id}/complete`, { method: 'POST' })
}

export async function createSummary(fields: SummaryFields, file: File): Promise<Summary> {
  const contentType = audioContentType(file.name)
  if (!contentType) throw new Error('El archivo debe ser MP3 o M4A')

  const { summary, upload } = await request<{
    summary: Summary
    upload: { url: string; headers: Record<string, string> }
  }>('/summaries', {
    method: 'POST',
    body: JSON.stringify({
      ...fields,
      originalFilename: file.name,
      contentType,
      sizeBytes: file.size,
    }),
  })

  let put: Response
  try {
    put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file })
  } catch {
    throw new Error('No se pudo subir el archivo a S3 (revisa tu conexión y el CORS del bucket)')
  }
  if (!put.ok) throw new Error(`S3 rechazó la carga (HTTP ${put.status})`)

  return request<Summary>(`/summaries/${summary.id}/complete`, { method: 'POST' })
}
