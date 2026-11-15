import type { Folder } from './types'

export const childrenOf = (folders: Folder[], parentId: string | null) =>
  folders.filter((f) => f.parentId === parentId)

/** Ancestros y la propia carpeta, de la raíz hacia ella. */
export function pathOf(folders: Folder[], id: string | null): Folder[] {
  const path: Folder[] = []
  for (let cur = folders.find((f) => f.id === id); cur; cur = folders.find((f) => f.id === cur!.parentId)) {
    path.unshift(cur)
  }
  return path
}

export const pathLabel = (folders: Folder[], id: string | null) =>
  pathOf(folders, id)
    .map((f) => f.name)
    .join(' › ')

/** La carpeta y todas sus descendientes. */
export function subtreeIds(folders: Folder[], id: string): Set<string> {
  const ids = [id]
  for (let i = 0; i < ids.length; i++) ids.push(...childrenOf(folders, ids[i]).map((f) => f.id))
  return new Set(ids)
}

/** Audios en la carpeta y en todas sus subcarpetas. */
export const totalCount = (folders: Folder[], id: string) =>
  folders.filter((f) => subtreeIds(folders, id).has(f.id)).reduce((sum, f) => sum + f.count, 0)

/** Niveles que ocupa la carpeta con sus descendientes (1 si no tiene subcarpetas). */
export const heightOf = (folders: Folder[], id: string): number =>
  1 + Math.max(0, ...childrenOf(folders, id).map((c) => heightOf(folders, c.id)))

export const MAX_DEPTH = 5

export interface FolderOption {
  id: string
  label: string
  depth: number
}

/** Árbol aplanado en orden alfabético, para selectores. `exclude` omite carpetas (y por tanto no se pueden elegir). */
export function folderOptions(folders: Folder[], exclude: Set<string> = new Set()): FolderOption[] {
  const out: FolderOption[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of childrenOf(folders, parentId)) {
      if (exclude.has(folder.id)) continue
      out.push({ id: folder.id, label: pathLabel(folders, folder.id), depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
