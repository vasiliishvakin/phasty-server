import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer } from '../src/server.js'
import { createMockPhpServer } from './helpers/mock-php-server.js'
import { createFixtures } from './helpers/fixtures.js'

describe('server.js — routing integration tests', () => {
  let fastify, phpMock, fixture, serverPort

  beforeAll(async () => {
    fixture = await createFixtures({
      'style.css': 'body { color: red; }',
      'index.html': '<html><body>Home</body></html>',
      'assets/app.js': 'console.log("app")',
      'subdir/index.html': '<html><body>Subdir</body></html>',
    })

    phpMock = await createMockPhpServer()

    fastify = await startServer({
      host: '127.0.0.1',
      port: 0,
      phpHost: '127.0.0.1',
      phpPort: phpMock.port,
      publicDir: fixture.dir,
      https: false,
      domain: null,
    })

    serverPort = fastify.server.address().port
  })

  afterAll(async () => {
    await fastify?.close()
    await phpMock?.close()
    await fixture?.cleanup()
  })

  // --- Health check ---

  it('GET /phasty/ping → 200 "pong"', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/phasty/ping`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('pong')
  })

  // --- Static files ---

  it('GET /style.css → 200 (sendFile, static)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/style.css`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('color: red')
  })

  it('GET /assets/app.js → 200 (nested file)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/assets/app.js`)
    expect(res.status).toBe(200)
  })

  // --- Index.html fallback ---

  it('GET / → 200 (index.html via candidate)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Home')
  })

  it('GET /subdir → 200 (subdir/index.html)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/subdir`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Subdir')
  })

  it('GET /subdir/ → 200 (trailing slash)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/subdir/`)
    expect(res.status).toBe(200)
  })

  // --- PHP fallback (reply.from) ---

  it('GET /nonexistent → fallback to PHP, body contains "PHP:"', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/nonexistent`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('PHP:')
  })

  it('GET /api/users?page=2 → fallback to PHP, URL passed as-is', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/users?page=2`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('/api/users')
  })

  it('POST /api/data → fallback to PHP (ANY method works)', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/data`, {
      method: 'POST',
      body: 'data=test'
    })
    expect(res.status).toBe(200)
  })

  // --- Path traversal protection ---

  it('GET /../../etc/passwd → does not return system file', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/../../etc/passwd`)
    const text = await res.text()
    // fileExists: filePath does not startsWith(root) → false → fallback to PHP mock
    // Either way must not return real /etc/passwd
    expect(text).not.toContain('root:x:')
  })

  it('GET /%2e%2e%2fetc%2fpasswd → path traversal via URL encoding', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/%2e%2e%2fetc%2fpasswd`)
    const text = await res.text()
    expect(text).not.toContain('root:x:')
  })

  // --- PHP error propagation ---

  it('PHP upstream 500 → Fastify proxies 500 to client', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/error-test`)
    expect(res.status).toBe(500)
  })
})
