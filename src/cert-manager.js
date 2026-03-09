import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'
import { X509Certificate } from 'node:crypto'
import { logger } from './logger.js'

const execFileAsync = promisify(execFile)

/**
 * Returns the HTTPS options object for Fastify, reading certs from letsencrypt.
 * @param {import('./types.js').PhastyConfig} config
 * @returns {{ key: Buffer, cert: Buffer }}
 */
export function loadTlsOptions(config) {
  const certDomain = config.wildcard ?? config.fqdn
  return {
    allowHTTP1: true,
    key: readFileSync(`/etc/letsencrypt/live/${certDomain}/privkey.pem`),
    cert: readFileSync(`/etc/letsencrypt/live/${certDomain}/fullchain.pem`),
  }
}

/**
 * Ensures a valid certificate exists for the domain; obtains or renews as needed.
 * @param {import('./types.js').PhastyConfig} config
 */
export async function ensureCert(config) {
  const { fqdn, wildcard, email, cloudflareIni } = config
  const certDomain = wildcard ?? fqdn
  const certPath = `/etc/letsencrypt/live/${certDomain}/fullchain.pem`
  const iniPath = cloudflareIni.replace(/^~/, process.env.HOME || '/root')

  const exists = await certExists(certPath)

  if (!exists) {
    logger.info(`phasty: obtaining certificate for ${certDomain}...`)
    await obtainCert({ fqdn, wildcard, email, iniPath })
    return
  }

  const daysLeft = getDaysLeft(certPath)
  if (daysLeft < 30) {
    logger.info(`phasty: certificate expires in ${daysLeft} days, renewing...`)
    await renewCert(certDomain)
  }
}

async function certExists(certPath) {
  try {
    await access(certPath)
    return true
  } catch {
    return false
  }
}

function getDaysLeft(certPath) {
  const cert = new X509Certificate(readFileSync(certPath))
  const validTo = new Date(cert.validTo)
  const now = new Date()
  return Math.floor((validTo - now) / (1000 * 60 * 60 * 24))
}

async function obtainCert({ fqdn, wildcard, email, iniPath }) {
  const domains = wildcard
    ? ['-d', `*.${wildcard}`, '-d', wildcard]
    : ['-d', fqdn]

  const args = [
    'certonly',
    '--dns-cloudflare',
    '--dns-cloudflare-credentials', iniPath,
    ...domains,
    '--email', email,
    '--agree-tos',
    '--non-interactive',
  ]

  try {
    logger.info(`$ certbot ${args.join(' ')}`)
    await execFileAsync('certbot', args, { signal: AbortSignal.timeout(120_000) })
  } catch (err) {
    logger.error(`phasty: certbot failed: ${err.message}`)
    process.exit(1)
  }
}

async function renewCert(domain) {
  try {
    const renewArgs = ['renew', '--cert-name', domain, '--non-interactive']
    logger.info(`$ certbot ${renewArgs.join(' ')}`)
    await execFileAsync('certbot', renewArgs, {
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    logger.error(`phasty: certbot renew failed: ${err.message}`)
    process.exit(1)
  }
}
