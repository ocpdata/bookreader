/**
 * Enlace «Comprar el libro» de un resumen, con el programa de afiliados de la tienda. Está apagado mientras no se
 * configuren `BOOK_LINKS_ENABLED=true` y `BOOK_LINK_TEMPLATE` (el formato del enlace de afiliado lo da el panel de la
 * tienda). Marcadores de la plantilla:
 *   {target}  la búsqueda en la tienda, sin codificar
 *   {url}     la misma URL, codificada para ir dentro de otra
 *   {query}   solo el texto buscado (ISBN, o título y autor), codificado
 * `BOOK_STORE_SEARCH_URL` es la búsqueda de la tienda; por defecto, Buscalibre México.
 */
const DEFAULT_SEARCH_URL = 'https://www.buscalibre.com.mx/libros/search?q=';
const MAX_QUERY_LENGTH = 200;

export function bookLinksEnabled() {
  return process.env.BOOK_LINKS_ENABLED === 'true' && Boolean(process.env.BOOK_LINK_TEMPLATE?.trim());
}

export function bookUrlFor(book: { title: string; author: string; isbn13?: string | null }): string | null {
  if (!bookLinksEnabled()) return null;
  const query = (book.isbn13 || `${book.title} ${book.author}`).trim().slice(0, MAX_QUERY_LENGTH);
  const target = `${process.env.BOOK_STORE_SEARCH_URL?.trim() || DEFAULT_SEARCH_URL}${encodeURIComponent(query)}`;
  const link = process.env
    .BOOK_LINK_TEMPLATE!.trim()
    .replaceAll('{target}', target)
    .replaceAll('{url}', encodeURIComponent(target))
    .replaceAll('{query}', encodeURIComponent(query));
  // Solo https: una plantilla mal escrita no debe producir un enlace que el navegador ejecute o rechace.
  return URL.canParse(link) && new URL(link).protocol === 'https:' ? link : null;
}
