// @ts-check
import { fileExists, getPort } from '../helpers.js'
import { getLogger } from '../logger/logger.js'
import path from 'node:path'

const logger = getLogger()

/**
   * @param {import('../processManager.js').ProcessManager} manager
   * @param {import('../config.js').Config} config
   */
export async function createPhpArtisanService(manager, config) {

    const { enabled, bin, host, workers, port: { start: portStart, stop: portStop } } = config.php
    const artisanPath = path.join(process.cwd(), 'artisan')

    if (enabled === false) return
    if (!await fileExists(artisanPath)) {
        logger.warn('artisan file not found, skipping PHP server')
        return
    }

    const port = await getPort(portStart, portStop)

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

    return {
        start
    }
}