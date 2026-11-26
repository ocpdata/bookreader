import { normalizeIsbn } from './isbn'

const BASE = 'https://openlibrary.org'
const TIMEOUT_MS = 10_000

export interface OpenLibraryWork {
  key: string
  title: string
  authors: string[]
  year: number | null
  editionCount: number
}

export interface OpenLibraryEdition {
  isbn13: string
  title: string
  publisher: string
  year: string
  /** Código de idioma de Open Library («spa», «eng»…); null si no lo indica. */
  language: string | null
}

const LANGUAGES: Record<string, string> = {
  spa: 'Español',
  eng: 'Inglés',
  fre: 'Francés',
  fra: 'Francés',
  por: 'Portugués',
  ger: 'Alemán',
  deu: 'Alemán',
  ita: 'Italiano',
  cat: 'Catalán',
}

export const languageLabel = (code: string | null) => (code ? (LANGUAGES[code] ?? code.toUpperCase()) : '')

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('No se pudo conectar con Open Library. Inténtalo de nuevo o escribe el ISBN a mano.')
  }
  if (!response.ok) throw new Error(`Open Library respondió con un error (${response.status}). Inténtalo más tarde.`)
  return response.json()
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

/** Obras que coinciden con el título y el autor (hasta 10). */
export async function searchWorks(title: string, author: string, signal?: AbortSignal): Promise<OpenLibraryWork[]> {
  const params = new URLSearchParams({ limit: '10', fields: 'key,title,author_name,first_publish_year,edition_count' })
  if (title.trim()) params.set('title', title.trim())
  if (author.trim()) params.set('author', author.trim())
  const data = asRecord(await getJson(`/search.json?${params}`, signal))
  const docs = Array.isArray(data.docs) ? data.docs.map(asRecord) : []
  return docs
    .filter((doc) => typeof doc.key === 'string' && /^\/works\/OL\d+W$/.test(doc.key) && typeof doc.title === 'string')
    .map((doc) => ({
      key: doc.key as string,
      title: doc.title as string,
      authors: asStrings(doc.author_name),
      year: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : null,
      editionCount: typeof doc.edition_count === 'number' ? doc.edition_count : 0,
    }))
}

/** Ediciones de una obra que tienen ISBN (los de 10 dígitos se convierten); las del español primero. */
export async function listEditions(workKey: string, signal?: AbortSignal): Promise<OpenLibraryEdition[]> {
  if (!/^\/works\/OL\d+W$/.test(workKey)) return []
  const data = asRecord(await getJson(`${workKey}/editions.json?limit=100`, signal))
  const entries = Array.isArray(data.entries) ? data.entries.map(asRecord) : []
  const seen = new Set<string>()
  const editions: OpenLibraryEdition[] = []
  for (const entry of entries) {
    const isbn13 = [...asStrings(entry.isbn_13), ...asStrings(entry.isbn_10)].map(normalizeIsbn).find((value): value is string => value !== null)
    if (!isbn13 || seen.has(isbn13)) continue
    seen.add(isbn13)
    const language = asStrings(Array.isArray(entry.languages) ? entry.languages.map((item) => asRecord(item).key) : [])[0]
    editions.push({
      isbn13,
      title: typeof entry.title === 'string' ? entry.title : '',
      publisher: asStrings(entry.publishers)[0] ?? '',
      year: typeof entry.publish_date === 'string' ? (/\d{4}/.exec(entry.publish_date)?.[0] ?? '') : '',
      language: language ? language.replace('/languages/', '') : null,
    })
  }
  const rank = (edition: OpenLibraryEdition) => (edition.language === 'spa' ? 0 : 1)
  return editions.sort((a, b) => rank(a) - rank(b) || b.year.localeCompare(a.year))
}
