import Fastify from 'fastify'
import handlerPlugin from './plugins/handler.js'

/**
 * @param {import('../config.js').Config} config
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function build({ config, logger, phpHandler, tlsOptions }) {
    const fastify = Fastify({
        loggerInstance: logger,
        ...(tlsOptions ? { https: tlsOptions } : {}),
    })

    // plugins & middleware
    await fastify.register(handlerPlugin, {
        config,
        logger,
        phpHandler
    })

    return fastify
}

export async function createServer({ config, logger, port, phpHandler, tlsOptions }) {
    const fastify = await build({ config, logger, phpHandler, tlsOptions })

    let started = false

    async function start() {
        if (started) return fastify

        const host = config.server.host

        try {
            await fastify.listen({ host, port })
        } catch (err) {
            throw new Error(`Failed to start server on ${host}:${port}: ${err.message}`)
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
    }
}