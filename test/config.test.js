import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFixtures } from './helpers/fixtures.js'

// Mock port-finder — fixed ports for determinism
vi.mock('../src/port-finder.js', () => ({
  findFreePort: vi.fn(async (start) => start + 1)
}))

// Import after mock
const { loadConfig, detectVite, loadUserConfig } = await import('../src/config.js')

describe('detectVite', () => {
  let fixture
  let originalCwd

  beforeEach(() => { originalCwd = process.cwd() })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fixture?.cleanup()
    fixture = null
  })

  it('returns true if vite.config.js exists', async () => {
    fixture = await createFixtures({ 'vite.config.js': 'export default {}' })
    process.chdir(fixture.dir)
    expect(await detectVite()).toBe(true)
  })

  it('returns true if vite.config.ts exists', async () => {
    fixture = await createFixtures({ 'vite.config.ts': 'export default {}' })
    process.chdir(fixture.dir)
    expect(await detectVite()).toBe(true)
  })

  it('returns false if no vite config exists', async () => {
    fixture = await createFixtures({ 'some-file.js': '' })
    process.chdir(fixture.dir)
    expect(await detectVite()).toBe(false)
  })
})

describe('loadConfig', () => {
  let fixture
  let originalCwd

  beforeEach(() => { originalCwd = process.cwd() })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fixture?.cleanup()
    fixture = null
    vi.restoreAllMocks()
  })

  it('no phasty.config.js → defaults (host, php, https)', async () => {
    fixture = await createFixtures({ 'public/index.html': '<html>' })
    process.chdir(fixture.dir)

    const config = await loadConfig({ port: 9500, phpPort: 9501 })
    expect(config.host).toBe('0.0.0.0')
    expect(config.php).toBe('php')
    expect(config.https).toBe(false)
    expect(config.phpHost).toBe('127.0.0.1')
  })

  it('CLI args override defaults', async () => {
    fixture = await createFixtures({ 'public/x.txt': 'x' })
    process.chdir(fixture.dir)

    const config = await loadConfig({ port: 7777, phpPort: 7778, host: '127.0.0.1' })
    expect(config.port).toBe(7777)
    expect(config.phpPort).toBe(7778)
    expect(config.host).toBe('127.0.0.1')
  })

  it('artisan file exists → config.artisan === true', async () => {
    fixture = await createFixtures({
      'artisan': '#!/usr/bin/env php',
      'public/index.html': '<html>'
    })
    process.chdir(fixture.dir)

    const config = await loadConfig({ port: 9600, phpPort: 9601 })
    expect(config.artisan).toBe(true)
  })

  it('no artisan file → config.artisan === false', async () => {
    fixture = await createFixtures({ 'public/x.css': 'body{}' })
    process.chdir(fixture.dir)

    const config = await loadConfig({ port: 9700, phpPort: 9701 })
    expect(config.artisan).toBe(false)
  })

  it('no public/ and no artisan → publicDirFallback === true, publicDir === CWD', async () => {
    fixture = await createFixtures({ 'some-file.txt': 'hello' })
    process.chdir(fixture.dir)

    const config = await loadConfig({ port: 9800, phpPort: 9801 })
    expect(config.publicDirFallback).toBe(true)
    expect(config.publicDir).toBe(fixture.dir)
  })

  it('https: true without domain → process.exit(1)', async () => {
    fixture = await createFixtures({ 'public/x.html': '' })
    process.chdir(fixture.dir)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`)
    })

    await expect(loadConfig({ https: true, port: 9850, phpPort: 9851 }))
      .rejects.toThrow('exit:1')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('https: true without email → process.exit(1)', async () => {
    fixture = await createFixtures({ 'public/x.html': '' })
    process.chdir(fixture.dir)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`)
    })

    await expect(loadConfig({ https: true, domain: 'example.com', port: 9860, phpPort: 9861 }))
      .rejects.toThrow('exit:1')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('vite.config.js exists → config.vite === true (auto-detect)', async () => {
    fixture = await createFixtures({
      'vite.config.js': 'export default {}',
      'public/app.js': ''
    })
    process.chdir(fixture.dir)

    const config = await loadConfig({ port: 9900, phpPort: 9901, vitePort: 9902, viteInternalPort: 9903 })
    expect(config.vite).toBe(true)
  })

  it('no vite config → config.vite === false', async () => {
    fixture = await createFixtures({ 'public/app.js': '' })
    process.chdir(fixture.dir)

    const config = await loadConfig({ port: 9910, phpPort: 9911 })
    expect(config.vite).toBe(false)
  })
})

describe('loadUserConfig', () => {
  let originalHome

  beforeEach(() => { originalHome = process.env.HOME })
  afterEach(() => {
    process.env.HOME = originalHome
    vi.restoreAllMocks()
  })

  it('returns {} if ~/.phasty.json does not exist', async () => {
    process.env.HOME = '/nonexistent-dir-12345'
    const result = await loadUserConfig()
    expect(result).toEqual({})
  })

  it('returns parsed object from ~/.phasty.json', async () => {
    const fixture = await createFixtures({ '.phasty.json': '{"php":"/usr/local/bin/php","host":"127.0.0.1"}' })
    process.env.HOME = fixture.dir
    const result = await loadUserConfig()
    expect(result).toEqual({ php: '/usr/local/bin/php', host: '127.0.0.1' })
    await fixture.cleanup()
  })

  it('exits with error if ~/.phasty.json has invalid JSON', async () => {
    const fixture = await createFixtures({ '.phasty.json': '{invalid json}' })
    process.env.HOME = fixture.dir
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`)
    })
    await expect(loadUserConfig()).rejects.toThrow('exit:1')
    expect(exitSpy).toHaveBeenCalledWith(1)
    await fixture.cleanup()
  })

  it('user config is overridden by project config', async () => {
    const userFixture = await createFixtures({ '.phasty.json': '{"host":"1.2.3.4"}' })
    const projFixture = await createFixtures({ 'public/x.html': '', 'phasty.config.js': 'export default { host: "5.6.7.8" }' })
    process.env.HOME = userFixture.dir
    const originalCwd = process.cwd()
    process.chdir(projFixture.dir)
    const config = await loadConfig({ port: 9920, phpPort: 9921 })
    expect(config.host).toBe('5.6.7.8')
    process.chdir(originalCwd)
    await userFixture.cleanup()
    await projFixture.cleanup()
  })

  it('user config is overridden by CLI args', async () => {
    const userFixture = await createFixtures({ '.phasty.json': '{"host":"1.2.3.4"}' })
    const projFixture = await createFixtures({ 'public/x.html': '' })
    process.env.HOME = userFixture.dir
    const originalCwd = process.cwd()
    process.chdir(projFixture.dir)
    const config = await loadConfig({ port: 9930, phpPort: 9931, host: '9.9.9.9' })
    expect(config.host).toBe('9.9.9.9')
    process.chdir(originalCwd)
    await userFixture.cleanup()
    await projFixture.cleanup()
  })
})
