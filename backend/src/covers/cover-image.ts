import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path/posix';
import sharp = require('sharp');

/** Tope del archivo subido; coincide con el límite por defecto de Nginx (1 MB) y el cliente reduce antes de enviar. */
export const MAX_COVER_BYTES = 1_000_000;
export const COVER_MAX_SIDE = 800;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
// Evita "bombas" de descompresión: una imagen diminuta en bytes puede declarar miles de millones de píxeles.
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Normaliza cualquier JPEG/PNG/WebP a un JPEG de a lo sumo 800 px por lado, sin metadatos (EXIF, GPS).
 * Al recodificar, el contenido guardado y servido es siempre una imagen válida creada por nosotros.
 */
export async function normalizeCover(input: Buffer): Promise<Buffer> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const { format } = await image.metadata();
    if (!format || !ALLOWED_FORMATS.has(format)) throw new Error('formato');
    return await image
      .rotate()
      .resize(COVER_MAX_SIDE, COVER_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new BadRequestException('La portada debe ser una imagen JPEG, PNG o WebP válida');
  }
}

/** Clave nueva para una portada, en el mismo prefijo que el audio. El sufijo cambia en cada carga (cache y reemplazo seguros). */
export function newCoverKey(audioKey: string): string {
  return `${dirname(audioKey)}/cover-${randomBytes(4).toString('hex')}.jpg`;
}

/** Parte aleatoria de la clave, usada como versión en la URL para invalidar la caché al cambiar la portada. */
export const coverVersion = (coverKey: string) => /cover-([0-9a-f]{8})\.jpg$/.exec(coverKey)?.[1] ?? '0';
