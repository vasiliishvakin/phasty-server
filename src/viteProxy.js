import Fastify from 'fastify'
import httpProxy from '@fastify/http-proxy'
import { getPort } from './helpers.js'

/**
 * @param {import('../config.js').Config} config
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function createViteProxy({ config, logger, viteInternalPort, tlsOptions }) {
    const fastify = Fastify({
        loggerInstance: logger,
        ...(tlsOptions ? { https: tlsOptions } : {}),
    })

    const { host, port: portRange, instance: instanceConfig } = config.vite
    const { host: viteInternalHost } = instanceConfig

    const port = await getPort(portRange.start, portRange.stop)

    const upstream = `http://${viteInternalHost}:${viteInternalPort}`

    await fastify.register(httpProxy, {
        upstream,
        websocket: true,
    })

    const mainOrigin = `${host}:${port}`
    logger.info(`Vite proxy configured to forward ${mainOrigin} to ${upstream}`)

    let started = false
    async function start() {
        if (started) return fastify

        await fastify.listen({ host, port })
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
    }
}