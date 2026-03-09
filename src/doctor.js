import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import pc from 'picocolors'

const execFileAsync = promisify(execFile)

// ── helpers ────────────────────────────────────────────────────────────────

async function fileExists(filePath) {
  try { await access(filePath); return true } catch { return false }
}

const ok   = (message)      => ({ status: 'ok',   message })
const warn = (message, tip) => ({ status: 'warn',  message, tip })
const fail = (message, tip) => ({ status: 'fail',  message, tip })
const skip = (message)      => ({ status: 'skip',  message })

// ── raw config (no validation, no port allocation) ────────────────────────

async function loadRawConfig() {
  const defaults = {
    https: false,
    domain: null,
    email: null,
    wildcard: null,
    cloudflareIni: '~/.secrets/cloudflare.ini',
    vite: null,
  }
  let fileConfig = {}
  try {
    const mod = await import(path.join(process.cwd(), 'phasty.config.js'))
    fileConfig = mod.default ?? {}
  } catch {}
  return { ...defaults, ...fileConfig }
}

// ── checks ─────────────────────────────────────────────────────────────────
//
// Each check: { group: string, name: string, run(cfg): Promise<Result> }
// Result: { status: 'ok'|'warn'|'fail'|'skip', message: string, tip?: string }
//
// Add new checks here — they will be picked up automatically.

const checks = [

  // ── Vite ──────────────────────────────────────────────────────────────────

  {
    group: 'Vite',
    name: 'vite.config found',
    async run(_cfg) {
      const cwd = process.cwd()
      const found =
        await fileExists(path.join(cwd, 'vite.config.js')) ||
        await fileExists(path.join(cwd, 'vite.config.ts'))
      if (!found) return skip('vite.config not found — Vite is not used')
      return ok('vite.config found')
    },
  },

  {
    group: 'Vite',
    name: 'PHASTY_VITE_ORIGIN used in vite.config',
    async run(_cfg) {
      const cwd = process.cwd()
      let content = null
      for (const name of ['vite.config.js', 'vite.config.ts']) {
        try { content = await readFile(path.join(cwd, name), 'utf8'); break } catch {}
      }
      if (!content) return skip('vite.config not found')
      if (content.includes('PHASTY_VITE_ORIGIN')) return ok('PHASTY_VITE_ORIGIN is used')
      return warn(
        'PHASTY_VITE_ORIGIN not found in vite.config',
        'Add server.origin: process.env.PHASTY_VITE_ORIGIN || "http://localhost:5173"',
      )
    },
  },

  // ── Laravel ───────────────────────────────────────────────────────────────

  {
    group: 'Laravel',
    name: '.env exists',
    async run(_cfg) {
      const found = await fileExists(path.join(process.cwd(), '.env'))
      if (!found) return warn('.env not found', 'Copy .env.example → .env and fill in the values')
      return ok('.env found')
    },
  },

  {
    group: 'Laravel',
    name: 'APP_KEY is set',
    async run(_cfg) {
      let content
      try { content = await readFile(path.join(process.cwd(), '.env'), 'utf8') } catch { return skip('.env not found') }
      const val = content.match(/^APP_KEY=(.+)$/m)?.[1]?.trim()
      if (!val) return fail('APP_KEY is not set', 'Run: php artisan key:generate')
      return ok('APP_KEY is set')
    },
  },

  {
    group: 'Laravel',
    name: 'APP_URL is set',
    async run(_cfg) {
      let content
      try { content = await readFile(path.join(process.cwd(), '.env'), 'utf8') } catch { return skip('.env not found') }
      const val = content.match(/^APP_URL=(.+)$/m)?.[1]?.trim()
      if (!val) return warn('APP_URL is not set', 'phasty updates APP_URL automatically on start')
      return ok(`APP_URL = ${val}`)
    },
  },

  // ── HTTPS ─────────────────────────────────────────────────────────────────

  {
    group: 'HTTPS',
    name: 'https enabled',
    async run(cfg) {
      if (!cfg.https) return skip('https is disabled in config')
      return ok('https is enabled')
    },
  },

  {
    group: 'HTTPS',
    name: 'domain is set',
    async run(cfg) {
      if (!cfg.https) return skip('https is disabled')
      if (!cfg.domain) return fail('domain is not set', 'Set domain in phasty.config.js')
      return ok(`domain: ${cfg.domain}`)
    },
  },

  {
    group: 'HTTPS',
    name: 'email is set',
    async run(cfg) {
      if (!cfg.https) return skip('https is disabled')
      if (!cfg.email) return fail('email is not set', 'Set email in phasty.config.js for certificate registration')
      return ok(`email: ${cfg.email}`)
    },
  },

  {
    group: 'HTTPS',
    name: 'cloudflareIni file exists',
    async run(cfg) {
      if (!cfg.https) return skip('https is disabled')
      const iniPath = cfg.cloudflareIni.replace(/^~/, process.env.HOME || '/root')
      const found = await fileExists(iniPath)
      if (!found) return fail(`${iniPath} not found`, 'Create the file with: dns_cloudflare_api_token = <your_token>')
      return ok('cloudflare.ini found')
    },
  },

  {
    group: 'HTTPS',
    name: 'certbot is installed',
    async run(cfg) {
      if (!cfg.https) return skip('https is disabled')
      try {
        await execFileAsync('certbot', ['--version'], { timeout: 5000 })
        return ok('certbot is installed')
      } catch {
        return fail('certbot not found', 'Install: apt install certbot')
      }
    },
  },

  {
    group: 'HTTPS',
    name: 'certbot dns-cloudflare plugin available',
    async run(cfg) {
      if (!cfg.https) return skip('https is disabled')
      try {
        const { stdout, stderr } = await execFileAsync('certbot', ['plugins'], { timeout: 10000 })
        const output = stdout + stderr
        if (output.includes('dns-cloudflare')) return ok('dns-cloudflare plugin is available')
        return fail('dns-cloudflare plugin not found', 'Install: apt install python3-certbot-dns-cloudflare')
      } catch {
        return fail('could not query certbot plugins', 'Make sure certbot is installed')
      }
    },
  },

  {
    group: 'HTTPS',
    name: 'certificate exists',
    async run(cfg) {
      if (!cfg.https) return skip('https is disabled')
      const certDomain = cfg.wildcard ?? cfg.domain
      if (!certDomain) return skip('domain is not set')
      const certPath = `/etc/letsencrypt/live/${certDomain}/fullchain.pem`
      const found = await fileExists(certPath)
      if (!found) return fail(`certificate not found: ${certPath}`, 'Run phasty start — it will obtain the certificate automatically')
      return ok(`certificate found: ${certPath}`)
    },
  },

]

// ── runner ─────────────────────────────────────────────────────────────────

export async function runDoctor() {
  const cfg = await loadRawConfig()

  console.log('')
  console.log(`  ${pc.bold('phasty doctor')}  ${pc.dim('configuration check')}`)
  console.log('')

  let currentGroup = null
  let issueCount = 0

  for (const check of checks) {
    if (check.group !== currentGroup) {
      if (currentGroup !== null) console.log('')
      currentGroup = check.group
      console.log(`  ${pc.bold(pc.cyan(currentGroup))}`)
    }

    const result = await check.run(cfg)

    const icon =
      result.status === 'ok'   ? pc.green('✓') :
      result.status === 'warn' ? pc.yellow('!') :
      result.status === 'fail' ? pc.red('✗')   :
      /* skip */                 pc.dim('–')

    console.log(`  ${icon}  ${result.status === 'skip' ? pc.dim(result.message) : result.message}`)

    if (result.tip) {
      console.log(`     ${pc.dim('→ ' + result.tip)}`)
      issueCount++
    }
  }

  console.log('')
  if (issueCount === 0) {
    console.log(`  ${pc.green('✓ All checks passed')}`)
  } else {
    console.log(`  ${pc.yellow(`! Recommendations: ${issueCount}`)}`)
  }
  console.log('')
}
