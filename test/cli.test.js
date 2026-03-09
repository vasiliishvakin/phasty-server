import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { access } from 'node:fs/promises'
import { createFixtures } from './helpers/fixtures.js'

// Mock heavy dependencies so commandStart does not spin up real processes
vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    host: '127.0.0.1',
    port: 9000,
    phpHost: '127.0.0.1',
    phpPort: 9999,
    publicDir: '/tmp',
    https: false,
    domain: null,
    artisan: false,
    vite: false,
    publicDirFallback: false,
  })
}))
vi.mock('../src/server.js', () => ({
  startServer: vi.fn().mockResolvedValue({
    server: { address: () => ({ port: 9000 }), closeAllConnections: vi.fn() },
    close: vi.fn().mockResolvedValue(undefined),
  })
}))
vi.mock('../src/cert-manager.js', () => ({
  ensureCert: vi.fn().mockResolvedValue(undefined),
  loadTlsOptions: vi.fn().mockReturnValue({ key: Buffer.from(''), cert: Buffer.from('') }),
}))
vi.mock('../src/vite-proxy.js', () => ({
  startViteProxy: vi.fn().mockResolvedValue({
    server: { closeAllConnections: vi.fn() },
    close: vi.fn().mockResolvedValue(undefined),
  })
}))

const { main } = await import('../src/cli.js')

describe('main() — top-level flags', () => {
  afterEach(() => vi.restoreAllMocks())

  it('--help prints help containing "phasty"', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(['--help'])
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('phasty'))
  })

  it('-h prints help', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(['-h'])
    expect(logSpy).toHaveBeenCalled()
  })

  it('--version prints version in x.y.z format', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(['--version'])
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\d+\.\d+\.\d+/))
  })

  it('no args → prints help', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await main([])
    expect(logSpy).toHaveBeenCalled()
  })

  it('unknown command → process.exit(1)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(main(['unknown-command'])).rejects.toThrow('exit:1')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('main() — init command', () => {
  let fixture
  let originalCwd

  afterEach(async () => {
    if (originalCwd) process.chdir(originalCwd)
    await fixture?.cleanup()
    fixture = null
    vi.restoreAllMocks()
  })

  it('init creates phasty.config.js', async () => {
    fixture = await createFixtures({})
    originalCwd = process.cwd()
    process.chdir(fixture.dir)

    vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(['init'])

    const exists = await access(path.join(fixture.dir, 'phasty.config.js'))
      .then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it('init exits if phasty.config.js already exists', async () => {
    fixture = await createFixtures({ 'phasty.config.js': 'export default {}' })
    originalCwd = process.cwd()
    process.chdir(fixture.dir)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`)
    })

    await expect(main(['init'])).rejects.toThrow('exit:1')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
