import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let server
let api
const originalFetch = globalThis.fetch

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
  })
  api = await server.ssrLoadModule('/src/api.ts')
})

afterEach(() => {
  globalThis.fetch = originalFetch
  api.onUnauthorized(null)
})

after(async () => {
  await server?.close()
})

test('shares the library or selected audios using the existing JSON request contract', async () => {
  const requests = []
  globalThis.fetch = async (path, init) => {
    requests.push({ path, method: init.method, headers: init.headers, body: JSON.parse(init.body) })
    return Response.json({ id: 'share-id' }, { status: 201 })
  }
  await api.createShare({ email: 'reader@example.test', scope: 'LIBRARY' })
  await api.createShare({ email: 'reader@example.test', scope: 'ITEMS', summaryIds: ['audio-1', 'audio-2'] })
  assert.deepEqual(requests, [
    { path: '/api/shares', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { email: 'reader@example.test', scope: 'LIBRARY' } },
    { path: '/api/shares', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { email: 'reader@example.test', scope: 'ITEMS', summaryIds: ['audio-1', 'audio-2'] } },
  ])
})

test('preserves the sharing context when registering and resending verification', async () => {
  const requests = []
  globalThis.fetch = async (path, init) => {
    requests.push({ path, body: JSON.parse(init.body) })
    return Response.json({ message: 'ok' }, { status: 202 })
  }
  await api.registerAccount({ email: 'reader@example.test', name: 'Lector', password: 'password', acceptTerms: true, source: 'share' })
  await api.resendVerification('reader@example.test', 'share')
  await api.resendVerification('reader@example.test')
  assert.deepEqual(requests.map(({ body }) => body.source), ['share', 'share', undefined])
})

test('reads backend availability and encodes invitation IDs for actions with empty responses', async () => {
  const requests = []
  globalThis.fetch = async (path, init) => {
    requests.push([path, init?.method ?? 'GET'])
    return path.endsWith('/config') ? Response.json({ enabled: false }) : new Response(null, { status: 204 })
  }
  assert.deepEqual(await api.getSharingConfig(), { enabled: false })
  await api.acceptShare('id/1')
  await api.rejectShare('id/1')
  await api.resendShare('id/1')
  await api.revokeShare('id/1')
  assert.deepEqual(requests, [
    ['/api/shares/config', 'GET'],
    ['/api/shares/id%2F1/accept', 'POST'],
    ['/api/shares/id%2F1/reject', 'POST'],
    ['/api/shares/id%2F1/resend', 'POST'],
    ['/api/shares/id%2F1', 'DELETE'],
  ])
})

test('shared items wait for in-flight personal progress saves before reading', async () => {
  const requests = []
  let finishSave
  globalThis.fetch = async (path) => {
    requests.push(path)
    if (path.endsWith('/progress')) return new Promise((resolve) => { finishSave = resolve })
    return Response.json([{ id: 'audio-1', isOwner: false, ownerName: 'Lucía' }])
  }
  const saving = api.saveProgress('audio-1', { positionSeconds: 42 })
  const reading = api.listSharedItems()
  await Promise.resolve()
  assert.deepEqual(requests, ['/api/summaries/audio-1/progress'])
  finishSave(Response.json({ positionSeconds: 42, completed: false, updatedAt: '2026-11-24T00:00:00Z' }))
  await saving
  assert.deepEqual(await reading, [{ id: 'audio-1', isOwner: false, ownerName: 'Lucía' }])
  assert.deepEqual(requests, ['/api/summaries/audio-1/progress', '/api/shares/items'])
})

test('sharing errors preserve the shared authentication and error handling', async () => {
  let expired = false
  api.onUnauthorized(() => { expired = true })
  globalThis.fetch = async () => Response.json({ message: 'Sesión vencida' }, { status: 401 })
  await assert.rejects(api.listReceivedShares(), /Sesión vencida/)
  assert.equal(expired, true)
  globalThis.fetch = async () => Response.json({ message: ['Invitación vencida', 'Reenvíala'] }, { status: 400 })
  await assert.rejects(api.acceptShare('share-id'), /Invitación vencida\. Reenvíala/)
})
