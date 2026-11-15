import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ABS_VERSION, LIBRARY_FOLDER_ID, LIBRARY_ID, LIBRARY_NAME } from './abs.constants';

/**
 * Traducción de nuestros datos a la forma que esperan las apps de Audiobookshelf. Los clientes decodifican
 * de forma estricta (p. ej. todas las fechas son enteros en milisegundos), así que las formas se mantienen
 * fieles a la documentación oficial y a los modelos de las apps.
 */

export const itemInclude = (userId: string) =>
  ({
    category: true,
    tags: { include: { tag: true } },
    progress: { where: { userId } },
  }) satisfies Prisma.SummaryInclude;

export type ItemRow = Prisma.SummaryGetPayload<{ include: ReturnType<typeof itemInclude> }>;
export type ProgressRow = ItemRow['progress'][number];

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');
const ms = (date: Date) => date.getTime();

/** Los clientes esperan un `ino` numérico (en texto) por archivo; se deriva del id para que sea estable. */
export const inoOf = (id: string) => BigInt(`0x${sha1(id).slice(0, 13)}`).toString();
export const authorIdOf = (name: string) => `aut_${sha1(name.trim().toLowerCase()).slice(0, 20)}`;
export const narratorIdOf = (name: string) => Buffer.from(name, 'utf8').toString('base64');

const extOf = (row: ItemRow) => (row.s3Key.endsWith('.m4a') ? '.m4a' : '.mp3');
const codecOf = (row: ItemRow) => (extOf(row) === '.m4a' ? 'aac' : 'mp3');
const durationOf = (row: { durationSeconds: number | null }) => row.durationSeconds ?? 0;

export function metadataOf(row: ItemRow) {
  return {
    title: row.title,
    titleIgnorePrefix: row.title,
    subtitle: row.summaryTitle,
    authors: [{ id: authorIdOf(row.author), name: row.author }],
    narrators: row.narrator ? [row.narrator] : [],
    series: [],
    genres: [row.category.name],
    publishedYear: null,
    publishedDate: null,
    publisher: null,
    description: row.description,
    descriptionPlain: row.description,
    isbn: null,
    asin: null,
    language: null,
    explicit: false,
    abridged: false,
    authorName: row.author,
    authorNameLF: row.author,
    narratorName: row.narrator ?? '',
    seriesName: '',
  };
}

export function audioFileOf(row: ItemRow) {
  const ext = extOf(row);
  return {
    index: 1,
    ino: inoOf(row.id),
    metadata: {
      filename: row.originalFilename,
      ext,
      path: `/resumenes/${row.id}/${row.originalFilename}`,
      relPath: `${row.id}/${row.originalFilename}`,
      size: row.sizeBytes,
      mtimeMs: ms(row.updatedAt),
      ctimeMs: ms(row.createdAt),
      birthtimeMs: ms(row.createdAt),
    },
    addedAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
    trackNumFromMeta: null,
    discNumFromMeta: null,
    trackNumFromFilename: null,
    discNumFromFilename: null,
    manuallyVerified: false,
    invalid: false,
    exclude: false,
    error: null,
    format: ext === '.m4a' ? 'MP4' : 'MP2/3 (MPEG audio layer 2/3)',
    duration: durationOf(row),
    bitRate: null,
    language: null,
    codec: codecOf(row),
    timeBase: '1/14112000',
    channels: 2,
    channelLayout: 'stereo',
    chapters: [],
    embeddedCoverArt: null,
    metaTags: {},
    mimeType: row.contentType,
    fileType: 'audio',
  };
}

export function trackOf(row: ItemRow, contentUrl = `/api/items/${row.id}/file/${inoOf(row.id)}`) {
  const file = audioFileOf(row);
  return {
    index: 1,
    startOffset: 0,
    duration: durationOf(row),
    title: row.originalFilename,
    contentUrl,
    mimeType: row.contentType,
    codec: file.codec,
    metadata: file.metadata,
  };
}

/** Elemento de la biblioteca. `expanded` añade archivos y pistas (detalle); la lista usa la versión mínima. */
export function itemOf(row: ItemRow, expanded = false) {
  const file = audioFileOf(row);
  return {
    id: row.id,
    ino: inoOf(row.id),
    libraryId: LIBRARY_ID,
    folderId: LIBRARY_FOLDER_ID,
    path: `/resumenes/${row.id}`,
    relPath: row.id,
    isFile: false,
    mtimeMs: ms(row.updatedAt),
    ctimeMs: ms(row.createdAt),
    birthtimeMs: ms(row.createdAt),
    addedAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
    lastScan: ms(row.updatedAt),
    scanVersion: ABS_VERSION,
    isMissing: false,
    isInvalid: false,
    mediaType: 'book',
    media: {
      libraryItemId: row.id,
      metadata: metadataOf(row),
      coverPath: row.coverKey ? `/metadata/items/${row.id}/cover.jpg` : null,
      tags: row.tags.map((t) => t.tag.name),
      numTracks: 1,
      numAudioFiles: 1,
      numChapters: 0,
      duration: durationOf(row),
      size: row.sizeBytes,
      ebookFormat: null,
      ...(expanded ? { audioFiles: [file], chapters: [], tracks: [trackOf(row)], ebookFile: null } : {}),
    },
    numFiles: 1,
    size: row.sizeBytes,
    ...(expanded ? { libraryFiles: [file] } : {}),
  };
}

export function progressOf(row: { id: string; durationSeconds: number | null }, p: ProgressRow) {
  const duration = durationOf(row);
  return {
    id: row.id,
    libraryItemId: row.id,
    episodeId: null,
    duration,
    progress: p.completed ? 1 : duration > 0 ? Math.min(1, p.positionSeconds / duration) : 0,
    currentTime: p.positionSeconds,
    isFinished: p.completed,
    hideFromContinueListening: p.hideFromContinue,
    ebookLocation: null,
    ebookProgress: 0,
    lastUpdate: ms(p.updatedAt),
    startedAt: ms(p.createdAt),
    finishedAt: p.completed ? ms(p.updatedAt) : null,
  };
}

export function libraryOf(now = new Date()) {
  return {
    id: LIBRARY_ID,
    name: LIBRARY_NAME,
    folders: [{ id: LIBRARY_FOLDER_ID, fullPath: '/resumenes', libraryId: LIBRARY_ID, addedAt: ms(now) }],
    displayOrder: 1,
    icon: 'audiobookshelf',
    mediaType: 'book',
    provider: 'audible',
    settings: {
      coverAspectRatio: 1,
      disableWatcher: true,
      skipMatchingMediaWithAsin: false,
      skipMatchingMediaWithIsbn: false,
      autoScanCronExpression: null,
    },
    createdAt: 0,
    lastUpdate: ms(now),
  };
}

export const serverSettings = () => ({
  id: 'server-settings',
  version: ABS_VERSION,
  language: 'es',
  sortingIgnorePrefix: false,
  chromecastEnabled: false,
  dateFormat: 'dd/MM/yyyy',
});

export function userOf(
  user: { id: string; name: string; email: string | null; createdAt: Date; lastLoginAt: Date | null },
  mediaProgress: unknown[],
  token?: string,
) {
  return {
    id: user.id,
    username: user.email ?? user.name,
    type: 'user',
    token,
    mediaProgress,
    seriesHideFromContinueListening: [],
    bookmarks: [],
    isActive: true,
    isLocked: false,
    lastSeen: ms(user.lastLoginAt ?? new Date()),
    createdAt: ms(user.createdAt),
    // Solo lectura y escucha: gestionar (editar, borrar, subir) se hace en la aplicación web.
    permissions: {
      download: true,
      update: false,
      delete: false,
      upload: false,
      createEreader: false,
      accessAllLibraries: true,
      accessAllTags: true,
      accessExplicitContent: true,
    },
    librariesAccessible: [],
    itemTagsAccessible: [],
    hasOpenIDLink: false,
  };
}

/** Respuesta de /login y /api/authorize. */
export function authorizePayload(user: ReturnType<typeof userOf>) {
  return {
    user,
    userDefaultLibraryId: LIBRARY_ID,
    serverSettings: serverSettings(),
    ereaderDevices: [],
    Source: 'bookreader',
  };
}

/** Sesión de reproducción "expandida" que devuelve POST /api/items/:id/play. */
export function playSessionOf(
  row: ItemRow,
  session: { id: string; userId: string; createdAt: Date },
  currentTime: number,
  deviceInfo: Record<string, unknown>,
  mediaPlayer: string,
) {
  const created = session.createdAt;
  return {
    id: session.id,
    userId: session.userId,
    libraryId: LIBRARY_ID,
    libraryItemId: row.id,
    episodeId: null,
    mediaType: 'book',
    mediaMetadata: metadataOf(row),
    chapters: [],
    displayTitle: row.title,
    displayAuthor: row.author,
    coverPath: row.coverKey ? `/metadata/items/${row.id}/cover.jpg` : null,
    duration: durationOf(row),
    playMethod: 0,
    mediaPlayer,
    deviceInfo,
    serverVersion: ABS_VERSION,
    date: created.toISOString().slice(0, 10),
    dayOfWeek: created.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    timeListening: 0,
    startTime: currentTime,
    currentTime,
    startedAt: ms(created),
    updatedAt: ms(created),
    audioTracks: [trackOf(row, `/public/session/${session.id}/track/1`)],
    libraryItem: itemOf(row, true),
  };
}
