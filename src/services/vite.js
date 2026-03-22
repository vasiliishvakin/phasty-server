// @ts-check
import { fileExists, getPort, resolveServerAddress } from '../helpers.js'
import { getLogger } from '../logger/logger.js'
import path from 'node:path'

const logger = getLogger()

/**
 * @param {import('../processManager.js').ProcessManager} manager
 * @param {import('../config.js').Config} config
 * @param {boolean} tlsEnabled
 * @param {number} [proxyPort]
 * @returns {Promise<{ start: () => import('execa').ResultPromise } | undefined>}
 */
export async function createViteService(manager, config, tlsEnabled, proxyPort) {

    const { enabled, bin, script, instance: { host, port: { start: portStart, stop: portStop } } } = config.vite
    const packageJsonPath = path.join(process.cwd(), 'package.json')

    if (enabled === false) return
    if (!await fileExists(packageJsonPath)) {
        logger.warn('package.json not found, skipping Vite')
        return
    }

    const port = await getPort(portStart, portStop)

    /**
     * @returns {import('execa').ResultPromise | undefined}
     */
    function start() {
        const params = ['run', script, '--', '--port', String(port), '--host', host]

        const serverAddress = resolveServerAddress(config, port, tlsEnabled)
        const env = {
            ...process.env,
            PROXY_SCHEME: serverAddress.scheme,
            PROXY_HOST: serverAddress.host,
            PROXY_PORT: String(proxyPort),
        }

        const opts = { env }

        logger.info(`Starting Vite (${bin} run ${script}) on ${host}:${port}...`)

        const meta = { host, port }

        return manager.run(bin, params, opts, meta)
    }

    return { start }
}
