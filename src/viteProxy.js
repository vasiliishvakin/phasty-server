import Fastify from 'fastify'
import httpProxy from '@fastify/http-proxy'
import { resolveServerAddress } from './helpers.js'

/**
 * @param {import('../config.js').Config} config
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function createViteProxy({ config, logger, port, viteInternalPort, tlsOptions }) {
    const fastify = Fastify({
        loggerInstance: logger,
        ...(tlsOptions ? { https: tlsOptions } : {}),
    })

    const { host, instance: instanceConfig } = config.vite
    const { host: viteInternalHost } = instanceConfig

    const upstream = `http://${viteInternalHost}:${viteInternalPort}`

    await fastify.register(httpProxy, {
        upstream,
        websocket: true,
    })

    const serverAddress = resolveServerAddress(config, port, !!tlsOptions)
    const origin = serverAddress.buildUrl()

    logger.info(`Vite proxy configured to forward ${origin} to ${upstream}`)

    let started = false
    async function start() {
        if (started) return fastify

        try {
            await fastify.listen({ host, port })
        } catch (err) {
            throw new Error(`Failed to start Vite proxy on ${host}:${port}: ${err.message}`)
        }
        fastify.server.setTimeout(0)

        started = true
        return fastify
    }

    async function shutdown() {
        if (!started) return
        await fastify.close()
        started = false
    }

    return {
        start,
        shutdown,
        instance: fastify,
        port,
        origin,
    }
}