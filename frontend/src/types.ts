export interface Category {
  id: string
  name: string
}

export interface Summary {
  id: string
  title: string
  author: string
  description: string | null
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
  description: string
  categoryId: string
}
