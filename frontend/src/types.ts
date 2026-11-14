export interface Category {
  id: string
  name: string
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
  categoryId: string
  category: Category
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
}

export type SortOption = 'recent' | 'title' | 'duration'
