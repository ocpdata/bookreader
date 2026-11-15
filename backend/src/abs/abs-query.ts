import { ItemRow, authorIdOf } from './abs.mapper';

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const text = (a: string, b: string) => collator.compare(a, b);
const time = (row: ItemRow) => row.progress[0]?.updatedAt.getTime() ?? 0;

const SORTERS: Record<string, (a: ItemRow, b: ItemRow) => number> = {
  'media.metadata.title': (a, b) => text(a.title, b.title),
  'media.metadata.authorName': (a, b) => text(a.author, b.author) || text(a.title, b.title),
  'media.metadata.authorNameLF': (a, b) => text(a.author, b.author) || text(a.title, b.title),
  'media.metadata.author': (a, b) => text(a.author, b.author) || text(a.title, b.title),
  addedAt: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  birthtimeMs: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  updatedAt: (a, b) => a.updatedAt.getTime() - b.updatedAt.getTime(),
  mtimeMs: (a, b) => a.updatedAt.getTime() - b.updatedAt.getTime(),
  size: (a, b) => a.sizeBytes - b.sizeBytes,
  'media.duration': (a, b) => (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0),
  progress: (a, b) => time(a) - time(b),
  'progress.finishedAt': (a, b) => time(a) - time(b),
  'progress.createdAt': (a, b) => (a.progress[0]?.createdAt.getTime() ?? 0) - (b.progress[0]?.createdAt.getTime() ?? 0),
};

export function sortItems(rows: ItemRow[], sort = 'addedAt', desc = false): ItemRow[] {
  const out = [...rows];
  if (sort === 'random') return out.sort(() => Math.random() - 0.5);
  const compare = SORTERS[sort] ?? SORTERS.addedAt;
  out.sort((a, b) => (desc ? compare(b, a) : compare(a, b)) || a.id.localeCompare(b.id));
  return out;
}

/** El valor del filtro viaja en base64 ("grupo.valor"); el de progreso puede llegar sin codificar. */
export function parseFilter(raw?: string): { group: string; value: string } | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot < 1) return null;
  const encoded = raw.slice(dot + 1);
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const reencodes = Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '') === encoded.replace(/=+$/, '');
  return { group: raw.slice(0, dot), value: reencodes ? decoded : encoded };
}

const same = (a: string, b: string) => collator.compare(a, b) === 0;

export function filterItems(rows: ItemRow[], raw?: string): ItemRow[] {
  const filter = parseFilter(raw);
  if (!filter) return rows;
  const { group, value } = filter;
  switch (group) {
    case 'progress':
      return rows.filter((row) => {
        const p = row.progress[0];
        const finished = p?.completed ?? false;
        const started = (p?.positionSeconds ?? 0) > 0;
        if (value === 'finished') return finished;
        if (value === 'in-progress') return !finished && started;
        if (value === 'not-started') return !finished && !started;
        if (value === 'not-finished') return !finished;
        return true;
      });
    case 'genres':
      return rows.filter((row) => same(row.category.name, value));
    case 'tags':
      return rows.filter((row) => row.tags.some((t) => same(t.tag.name, value)));
    case 'authors':
      return rows.filter((row) => authorIdOf(row.author) === value);
    case 'narrators':
      return rows.filter((row) => row.narrator !== null && same(row.narrator, value));
    case 'issues':
    case 'missing':
    case 'series':
    case 'languages':
    case 'publishers':
    case 'publishedDecades':
    case 'tracks':
    case 'ebooks':
      return [];
    default:
      return rows;
  }
}

export const toInt = (value: unknown, fallback: number) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
