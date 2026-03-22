// @ts-check
import { fileExists, getPort, resolveServerAddress } from '../helpers.js'
import { getLogger } from '../logger/logger.js'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

const logger = getLogger()

/**
   * @param {import('../processManager.js').ProcessManager} manager
   * @param {import('../config.js').Config} config
   * @param {boolean} tlsEnabled
   * @param {number} proxyPort
   */
export async function createPhpArtisanService(manager, config, tlsEnabled, proxyPort) {

    const { enabled, bin, host, workers, port: { start: portStart, stop: portStop } } = config.php
    const artisanPath = path.join(process.cwd(), 'artisan')

    if (enabled === false) return
    if (!await fileExists(artisanPath)) {
        logger.warn('artisan file not found, skipping PHP server')
        return
    }

    const port = await getPort(portStart, portStop)

    const serverAddress = resolveServerAddress(config, proxyPort, tlsEnabled)
    const origin = serverAddress.buildUrl()

    /**
    * @returns {import('execa').ResultPromise | undefined}
    */
    function start() {
        const params = [
            'artisan',
            'serve',
            '--host', host,
            '--port', String(port)
        ]

        const env = { ...process.env }

        if (workers) {
            env.PHP_CLI_SERVER_WORKERS = String(workers)
        }

        const opts = { env }

        logger.info(`Starting PHP artisan server on ${host} port ${port}...`)

        const meta = {
            host,
            port,
            workers: workers || 'auto',
        }

        return manager.run(
            bin,
            params,
            opts,
            meta,
        )
    }

    const cleanup = await patchDotEnv(path.join(process.cwd(), '.env'), 'APP_URL', origin, logger)

    return {
        start,
        cleanup,
    }
}

/**
 * @param {string} envPath
 * @param {string} key
 * @param {string} value
 * @param {ReturnType<import('../logger/logger.js').getLogger>} logger
 * @returns {Promise<() => Promise<void>>}
 */
const PHASTY_COMMENT_PREFIX = '# phasty: '

async function patchDotEnv(envPath, key, value, logger) {
    let original

    try {
        const content = await readFile(envPath, 'utf8')
        const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
        original = match ? match[1] : undefined

        let patched
        if (match) {
            // Replace existing line, prepend a backup comment above it
            patched = content.replace(
                new RegExp(`^${key}=.*$`, 'm'),
                `${PHASTY_COMMENT_PREFIX}${key}=${original}\n${key}=${value}`,
            )
        } else {
            patched = content + (content.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`
        }

        await writeFile(envPath, patched, 'utf8')
        logger.info(`Set ${key}=${value} in .env`)
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.warn(`Could not patch .env: ${err.message}`)
        }
        return async () => { }
    }

    return async () => {
        try {
            const content = await readFile(envPath, 'utf8')
            let restored
            if (original !== undefined) {
                // Remove backup comment and restore original value
                restored = content.replace(
                    new RegExp(`^${PHASTY_COMMENT_PREFIX}${key}=.*\\n${key}=.*$`, 'm'),
                    `${key}=${original}`,
                )
            } else {
                restored = content.replace(new RegExp(`^${key}=.*\n?`, 'm'), '')
            }
            await writeFile(envPath, restored, 'utf8')
            logger.info(`Restored ${key} in .env`)
        } catch (err) {
            logger.warn(`Could not restore .env: ${err.message}`)
        }
    }
}