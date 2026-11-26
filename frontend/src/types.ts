export interface Category {
  id: string
  name: string
}

export interface SelectableCategory extends Category {
  isCustom: boolean
}

export interface Progress {
  positionSeconds: number
  completed: boolean
  updatedAt: string
}

export interface Summary {
  id: string
  isOwner?: boolean
  /** Necesario para identificar al propietario de audios de bibliotecas compartidas. */
  ownerName?: string
  title: string
  author: string
  summaryTitle: string | null
  narrator: string | null
  description: string | null
  /** ISBN-13 de la edición del libro, si se indicó. */
  isbn13: string | null
  /** Enlace de compra del libro (de afiliado) o null si el servicio no lo ofrece. */
  bookUrl: string | null
  durationSeconds: number | null
  progress: Progress | null
  tags: string[]
  favorite: boolean
  categoryId: string
  category: Category
  folderId: string | null
  /** URL de la portada (con versión) o null si no tiene. */
  coverUrl: string | null
  originalFilename: string
  sizeBytes: number
  status: 'PENDING' | 'READY'
  createdAt: string
}

export interface Share {
  id: string
  email: string
  ownerName: string
  scope: 'LIBRARY' | 'ITEMS'
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REVOKED'
  createdAt: string
  expiresAt: string
  summaryIds: string[]
  summaries: { id: string; title: string; author: string }[]
}

export interface ShareFields {
  email: string
  scope: Share['scope']
  summaryIds?: string[]
}

export interface SummaryFields {
  title: string
  author: string
  summaryTitle: string
  narrator: string
  description: string
  /** ISBN-10 o ISBN-13; vacío lo borra. */
  isbn13?: string
  categoryId: string
  folderId: string | null
  tags: string[]
}

export type SortOption = 'recent' | 'title' | 'duration' | 'listened'

export type StatusFilter = 'finished' | 'unfinished'

export interface TagSuggestion {
  name: string
  count: number
}

export interface LibraryFilters {
  search: string
  categoryId: string
  tag: string
  favorite: boolean
  status: StatusFilter | ''
  sort: SortOption
}

export interface CategoryCount {
  id: string
  name: string
  count: number
}

export interface HomeData {
  total: number
  continueListening: Summary[]
  recent: Summary[]
  favorites: Summary[]
  categories: CategoryCount[]
}

export interface TrashItem {
  id: string
  title: string
  author: string
  category: string
  sizeBytes: number
  durationSeconds: number | null
  deletedAt: string
  purgeAt: string
}

export interface Folder {
  id: string
  parentId: string | null
  name: string
  /** Audios directamente en la carpeta (sin contar subcarpetas). */
  count: number
}
