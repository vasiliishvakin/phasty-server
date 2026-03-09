import * as v from 'valibot'
import fs from 'node:fs/promises'
import path from 'node:path'
import { findFreePort } from './port-finder.js'

/** @typedef {import('./types.js').PhastyConfig} PhastyConfig */

const DEFAULTS = {
  port: null,
  host: '0.0.0.0',
  phpPort: null,
  phpHost: '127.0.0.1',
  publicDir: 'public',
  php: 'php',
  https: false,
  domain: null,
  wildcard: null,
  email: null,
  cloudflareIni: '~/.secrets/cloudflare.ini',
  vite: null,
  vitePort: null,
  viteInternalPort: null,
}

const MergedConfigSchema = v.pipe(
  v.object({
    host: v.string(),
    port: v.nullable(v.number()),
    phpHost: v.string(),
    phpPort: v.nullable(v.number()),
    publicDir: v.string(),
    php: v.string(),
    https: v.boolean(),
    domain: v.nullable(v.string()),
    email: v.nullable(v.string()),
    wildcard: v.nullable(v.string()),
    cloudflareIni: v.string(),
    vite: v.nullable(v.boolean()),
    vitePort: v.nullable(v.number()),
    viteInternalPort: v.nullable(v.number()),
  }),
  v.check((c) => !c.https || Boolean(c.domain), 'https requires domain to be set'),
  v.check((c) => !c.https || Boolean(c.email), 'https requires email to be set'),
)

/**
 * Loads user-level config from ~/.phasty.json.
 * Returns {} if the file does not exist; exits on parse error.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadUserConfig() {
  const userConfigPath = path.join(process.env.HOME || '~', '.phasty.json')
  let raw
  try {
    raw = await fs.readFile(userConfigPath, 'utf8')
  } catch {
    return {}
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error(`phasty: invalid JSON in ${userConfigPath}: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Loads and resolves configuration from file, CLI args, and defaults.
 * Priority: CLI args > project config > user config > defaults
 * @param {Partial<PhastyConfig>} [cliArgs]
 * @returns {Promise<PhastyConfig>}
 */
export async function loadConfig(cliArgs = {}) {
  const userConfig = await loadUserConfig()

  let fileConfig = {}
  try {
    const configPath = path.join(process.cwd(), 'phasty.config.js')
    const mod = await import(configPath)
    fileConfig = mod.default ?? {}
  } catch {
    // no config file — use defaults
  }

  // Merge: CLI > project config > user config > defaults
  // Strip undefined CLI values so they don't shadow defaults
  const cleanCliArgs = Object.fromEntries(Object.entries(cliArgs).filter(([, v]) => v !== undefined))
  const merged = { ...DEFAULTS, ...userConfig, ...fileConfig, ...cleanCliArgs }

  const result = v.safeParse(MergedConfigSchema, merged)
  if (!result.success) {
    const issue = result.issues[0]
    const field = issue.path?.map((p) => p.key).join('.')
    const msg = field ? `${field}: ${issue.message}` : issue.message
    console.error(`phasty: ${msg}`)
    process.exit(1)
  }

  return resolveConfig(result.output)
}

/**
 * Resolves dynamic values: detects artisan, resolves publicDir, allocates ports.
 * @param {v.InferOutput<typeof MergedConfigSchema>} config
 * @returns {Promise<PhastyConfig>}
 */
async function resolveConfig(config) {
  config.fqdn = config.wildcard ? `${config.domain}.${config.wildcard}` : config.domain

  const artisan = await fileAccessible(path.join(process.cwd(), 'artisan'))
  config.artisan = artisan

  const publicDirResolved = path.resolve(config.publicDir)
  const publicDirExists = await fileAccessible(publicDirResolved)

  if (!publicDirExists) {
    if (artisan) {
      console.error(`phasty: publicDir does not exist: ${publicDirResolved}`)
      process.exit(1)
    }
    config.publicDir = process.cwd()
    config.publicDirFallback = true
  } else {
    config.publicDirFallback = false
  }

  if (!config.port) {
    config.port = await findFreePort(8001)
  }
  if (!config.phpPort) {
    config.phpPort = await findFreePort(config.port + 1)
  }

  if (config.vite === null) {
    config.vite = await detectVite()
  }

  if (config.vite) {
    if (!config.vitePort) {
      config.vitePort = await findFreePort(config.phpPort + 1)
    }
    if (!config.viteInternalPort) {
      config.viteInternalPort = await findFreePort(config.vitePort + 1)
    }
  }

  return config
}

export async function detectVite() {
  try {
    await fs.access(path.join(process.cwd(), 'vite.config.js'))
    return true
  } catch {
    try {
      await fs.access(path.join(process.cwd(), 'vite.config.ts'))
      return true
    } catch {
      return false
    }
  }
}

async function fileAccessible(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
