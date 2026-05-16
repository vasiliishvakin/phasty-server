// @ts-check
import { fileExists, getPort, resolveServerAddress } from '../helpers.js'
import { getLogger } from '../logger/logger.js'
import path from 'node:path'

const logger = getLogger()

/**
 * @param {import('../processManager.js').ProcessManager} manager
 * @param {import('../config.js').Config} config
 * @param {boolean} tlsEnabled
 * @param {number} proxyPort
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

        const serverAddress = resolveServerAddress(config, proxyPort, tlsEnabled)
        const origin = serverAddress.buildUrl()
        const env = {
            ...process.env,
            PHASTY_SCHEME: serverAddress.scheme,
            PHASTY_HOST: serverAddress.host,
            PHASTY_PORT: String(proxyPort),
            PHASTY_DOMAIN: serverAddress.host,
            PHASTY_VITE_ORIGIN: origin,
            PHASTY_VITE_PORT: String(proxyPort),
        }

        const opts = { env }

        logger.info(`Starting Vite (${bin} run ${script}) on ${host}:${port}...`)

        const meta = { host, port, killSignal: 'SIGINT' }

        return manager.run(bin, params, opts, meta)
    }

    return { start }
}
