import { describe, it, expect, afterEach } from 'vitest'
import { findFreePort } from '../src/port-finder.js'
import net from 'node:net'

describe('findFreePort', () => {
  const servers = []

  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await new Promise(resolve => s.close(resolve))
    }
  })

  async function occupyPort(port) {
    const server = net.createServer()
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
    servers.push(server)
    return server
  }

  it('returns port >= start', async () => {
    const port = await findFreePort(9000)
    expect(port).toBeGreaterThanOrEqual(9000)
    expect(port).toBeLessThan(65535)
  })

  it('returns a free port — can bind to it', async () => {
    const port = await findFreePort(9050)
    const server = net.createServer()
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.once('listening', resolve)
      server.listen(port, '127.0.0.1')
    })
    servers.push(server)
    expect(port).toBeGreaterThan(0)
  })

  it('skips occupied ports', async () => {
    await occupyPort(9100)
    const port = await findFreePort(9100)
    expect(port).not.toBe(9100)
    expect(port).toBeGreaterThan(9100)
  })

  it('returns exactly start if start is free', async () => {
    const free = await findFreePort(9200)
    const result = await findFreePort(free)
    expect(result).toBe(free)
  })
})
