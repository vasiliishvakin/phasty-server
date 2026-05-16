// @ts-check
import { readFile } from 'node:fs/promises'
import { X509Certificate } from 'node:crypto'
import os from 'node:os'
import { fileExists } from './helpers.js'
import { getRunner } from './run.js'

/**
 * https config as it looks when https.enabled = true (Zod guarantees domain and cert.email).
 * @typedef {NonNullable<import('./config.js').Config['https']> & { domain: string, cert: NonNullable<import('./config.js').Config['https']['cert']> & { email: string } }} HttpsConfig
 */

/**
 * @param {import('./config.js').Config['https']} httpsConfig
 * @returns {string}
 */
function getCertDir(httpsConfig) {
    const certDomain = httpsConfig?.cert?.certDomain
    if (certDomain) {
        return certDomain.replace(/^\*\./, '')
    }
    return httpsConfig?.domain ?? ''
}

/**
 * @param {string} p
 * @returns {string}
 */
function expandHome(p) {
    if (p.startsWith('~')) {
        return os.homedir() + p.slice(1)
    }
    return p
}

/**
 * @param {string} certPath
 * @param {number} [thresholdDays=14]
 * @returns {Promise<boolean>}
 */
async function isCertValid(certPath, thresholdDays = 14) {
    try {
        const pem = await readFile(certPath, 'utf8')
        const cert = new X509Certificate(pem)
        const expiresAt = new Date(cert.validTo)
        const threshold = new Date(Date.now() + thresholdDays * 24 * 60 * 60 * 1000)
        return expiresAt > threshold
    } catch {
        return false
    }
}

/**
 * @param {HttpsConfig} httpsConfig
 * @returns {string[]}
 */
function buildCertbotArgs(httpsConfig) {
    const { domain, cert } = httpsConfig
    const { email, certDomain, dns } = cert

    const credentialsFile = expandHome(dns.credentialsFile)

    const args = [
        'certonly',
        '--dns-cloudflare',
        '--dns-cloudflare-credentials', credentialsFile,
        '--non-interactive',
        '--agree-tos',
        '--email', email,
    ]

    if (certDomain) {
        if (certDomain.startsWith('*.')) {
            const base = certDomain.slice(2)
            args.push('-d', certDomain, '-d', base)
        } else {
            args.push('-d', certDomain)
        }
    } else {
        args.push('-d', domain)
    }

    return args
}

/**
 * @param {import('./config.js').Config} config
 * @param {*} logger
 */
export async function ensureCert(config, logger) {
    const httpsConfig = /** @type {HttpsConfig} */ (config.https)
    const certDir = getCertDir(httpsConfig)
    const certPath = `/etc/letsencrypt/live/${certDir}/fullchain.pem`

    if (await isCertValid(certPath, 14)) {
        logger.info('Certificate is valid')
        return
    }

    const runner = getRunner(logger)
    if (await fileExists(certPath)) {
        logger.info(`Renewing certificate for ${certDir}...`)
        await runner.run('certbot', ['renew', '--cert-name', certDir, '--non-interactive'])
    } else {
        logger.info('Obtaining new certificate via certbot...')
        await runner.run('certbot', buildCertbotArgs(httpsConfig))
    }
}

/**
 * Returns the HTTPS options object for Fastify, reading certs from letsencrypt.
 * @param {import('./config.js').Config} config
 * @returns {Promise<{ key: Buffer, cert: Buffer, allowHTTP1: boolean }>}
 */
export async function loadTlsOptions(config) {
    const certDir = getCertDir(config.https)
    const base = `/etc/letsencrypt/live/${certDir}`

    let key, cert
    try {
        ;[key, cert] = await Promise.all([
            readFile(`${base}/privkey.pem`),
            readFile(`${base}/fullchain.pem`)
        ])
    } catch (err) {
        throw new Error(`Failed to load TLS certificates from ${base}: ${err.message}`)
    }

    return {
        allowHTTP1: true,
        key,
        cert,
    }
}
