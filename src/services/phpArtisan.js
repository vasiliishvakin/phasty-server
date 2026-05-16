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

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Patches a key in a .env file with a new value, backing up the original.
 * If the key already exists, the original value is preserved as a comment
 * (`# phasty: KEY=original`) above the patched line so it can be restored.
 * If the key does not exist, it is appended to the end of the file.
 *
 * @param {string} envPath - Absolute path to the .env file
 * @param {string} key - Environment variable name to patch (e.g. `APP_URL`)
 * @param {string} value - New value to set
 * @param {import('pino').Logger} logger
 * @returns {Promise<() => Promise<void>>} Async cleanup function that restores
 *   the original value (or removes the key if it didn't exist before)
 */
export async function patchDotEnv(envPath, key, value, logger) {
    let original

    try {
        const content = await readFile(envPath, 'utf8')
        const escapedKey = escapeRegExp(key)
        const keyRegex = new RegExp(`^${escapedKey}=(.*)$`, 'm')
        const backupRegex = new RegExp(`^${escapeRegExp(PHASTY_COMMENT_PREFIX)}${escapedKey}=(.*)$`, 'm')
        const existingMatch = content.match(keyRegex)
        const backupMatch = content.match(backupRegex)
        original = backupMatch ? backupMatch[1] : existingMatch ? existingMatch[1] : undefined

        let patched
        if (existingMatch) {
            if (backupMatch) {
                patched = content.replace(keyRegex, () => `${key}=${value}`)
            } else {
                patched = content.replace(
                    keyRegex,
                    () => `${PHASTY_COMMENT_PREFIX}${key}=${original}\n${key}=${value}`,
                )
            }
        } else if (backupMatch) {
            patched = content.replace(
                backupRegex,
                match => `${match}\n${key}=${value}`,
            )
        } else {
            patched = content + (content.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`
        }

        await writeFile(envPath, patched, 'utf8')
        logger.info(`Set ${key}=${value} in .env`)
    } catch (err) {
        const error = /** @type {NodeJS.ErrnoException} */ (err)
        if (error.code !== 'ENOENT') {
            logger.warn(`Could not patch .env: ${error.message}`)
        }
        return async () => { }
    }

    return async () => {
        try {
            const content = await readFile(envPath, 'utf8')
            const escapedKey = escapeRegExp(key)
            let restored
            if (original !== undefined) {
                // Remove backup comment and restore original value.
                restored = content.replace(
                    new RegExp(`^${escapeRegExp(PHASTY_COMMENT_PREFIX)}${escapedKey}=.*\\n${escapedKey}=.*$`, 'm'),
                    () => `${key}=${original}`,
                ).replace(
                    new RegExp(`^${escapeRegExp(PHASTY_COMMENT_PREFIX)}${escapedKey}=.*$`, 'm'),
                    () => `${key}=${original}`,
                )
            } else {
                restored = content.replace(new RegExp(`^${escapedKey}=.*\n?`, 'm'), '')
            }
            await writeFile(envPath, restored, 'utf8')
            logger.info(`Restored ${key} in .env`)
        } catch (err) {
            const error = /** @type {Error} */ (err)
            logger.warn(`Could not restore .env: ${error.message}`)
        }
    }
}
