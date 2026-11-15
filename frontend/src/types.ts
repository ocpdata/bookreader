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
  title: string
  author: string
  summaryTitle: string | null
  narrator: string | null
  description: string | null
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

export interface SummaryFields {
  title: string
  author: string
  summaryTitle: string
  narrator: string
  description: string
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
