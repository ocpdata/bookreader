import type { Category, LibraryFilters, Progress, Summary, SummaryFields, TagSuggestion } from './types'

const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
}

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024

export function audioContentType(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return AUDIO_TYPES[ext] ?? null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    })
  } catch {
    throw new Error('No se pudo conectar con el servidor. ¿Está corriendo el backend?')
  }
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

export const listCategories = () => request<Category[]>('/categories')

export async function listSummaries({ search, categoryId, tag, favorite, status, sort }: LibraryFilters) {
  await settlePendingSaves()
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (categoryId) params.set('categoryId', categoryId)
  if (tag) params.set('tag', tag)
  if (favorite) params.set('favorite', 'true')
  if (status) params.set('status', status)
  params.set('sort', sort)
  return request<Summary[]>(`/summaries?${params}`)
}

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
