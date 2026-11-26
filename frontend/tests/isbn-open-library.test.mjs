import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let server
let isbn
let openLibrary
const originalFetch = globalThis.fetch

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
  })
  isbn = await server.ssrLoadModule('/src/isbn.ts')
  openLibrary = await server.ssrLoadModule('/src/openLibrary.ts')
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

after(async () => {
  await server.close()
})

const respond = (body, status = 200) => async () => new Response(JSON.stringify(body), { status })

test('normaliza ISBN-13 e ISBN-10 y rechaza los inválidos', () => {
  assert.equal(isbn.normalizeIsbn('978-0-201-61622-4'), '9780201616224')
  assert.equal(isbn.normalizeIsbn('0-201-61622-X'), '9780201616224')
  assert.equal(isbn.normalizeIsbn('9780201616225'), null)
  assert.equal(isbn.normalizeIsbn('abc'), null)
})

test('searchWorks descarta resultados sin clave de obra válida', async () => {
  let requested = ''
  globalThis.fetch = async (url) => {
    requested = String(url)
    return new Response(
      JSON.stringify({
        docs: [
          { key: '/works/OL1W', title: 'Las leyes del caos', author_name: ['Ilya Prigogine'], first_publish_year: 1997, edition_count: 4 },
          { key: '/authors/OL2A', title: 'No es una obra' },
          { key: '/works/OL3W' },
        ],
      }),
    )
  }
  const works = await openLibrary.searchWorks('las leyes del caos', 'Prigogine')
  assert.deepEqual(works, [{ key: '/works/OL1W', title: 'Las leyes del caos', authors: ['Ilya Prigogine'], year: 1997, editionCount: 4 }])
  const url = new URL(requested)
  assert.equal(url.origin + url.pathname, 'https://openlibrary.org/search.json')
  assert.equal(url.searchParams.get('title'), 'las leyes del caos')
  assert.equal(url.searchParams.get('author'), 'Prigogine')
})

test('listEditions convierte ISBN-10, quita duplicados y pone primero las ediciones en español', async () => {
  globalThis.fetch = respond({
    entries: [
      { title: 'Chaos', isbn_13: ['9780201616224'], languages: [{ key: '/languages/eng' }], publish_date: 'March 2001', publishers: ['Addison'] },
      { title: 'Las leyes del caos', isbn_10: ['8484322394'], languages: [{ key: '/languages/spa' }], publish_date: '2008', publishers: ['Crítica'] },
      { title: 'Duplicada', isbn_13: ['9788484322399'] },
      { title: 'Sin ISBN' },
      { title: 'ISBN roto', isbn_13: ['9780201616225'] },
    ],
  })
  const editions = await openLibrary.listEditions('/works/OL1W')
  assert.deepEqual(
    editions.map((edition) => [edition.isbn13, edition.language, edition.year, edition.publisher]),
    [
      ['9788484322399', 'spa', '2008', 'Crítica'],
      ['9780201616224', 'eng', '2001', 'Addison'],
    ],
  )
})

test('listEditions no consulta claves que no sean de una obra', async () => {
  globalThis.fetch = async () => {
    throw new Error('no debe llamarse')
  }
  assert.deepEqual(await openLibrary.listEditions('/authors/OL1A'), [])
})

test('traduce los errores de red y de servicio a mensajes comprensibles', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('failed')
  }
  await assert.rejects(openLibrary.searchWorks('x', ''), /No se pudo conectar con Open Library/)
  globalThis.fetch = respond({}, 503)
  await assert.rejects(openLibrary.searchWorks('x', ''), /Open Library respondió con un error \(503\)/)
})
