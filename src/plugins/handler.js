import replyFrom from '@fastify/reply-from'
import fastifyStatic from '@fastify/static'
import { fileExists, resolveSafePath } from '../helpers.js'

/**
 * @typedef {import('../config.js').Config} Config
 * @typedef {import('fastify').FastifyInstance} FastifyInstance
 * @typedef {import('fastify').FastifyRequest} FastifyRequest
 * @typedef {import('fastify').FastifyReply} FastifyReply
 */

/**
 *
 * @param {FastifyInstance} fastify
 * @returns {Promise<void>}
 */
export default async function handlerPlugin(fastify, { config, logger, phpHandler }) {

    // register plugins
    if (phpHandler) {
        await fastify.register(replyFrom,
            {
                base: `http://${phpHandler.host}:${phpHandler.port}`,
                undici: {
                    headersTimeout: 5 * 60 * 1000,
                    bodyTimeout: 5 * 60 * 1000,
                }
            }
        )
    }
    await fastify.register(fastifyStatic, {
        root: process.cwd(),
        decorateReply: true,
        wildcard: false,
        serve: false,
    })

    // register hooks
    // fastify.addHook('onRequest', async (request, reply) => {
    //     // pre-processing
    // })
    // fastify.addHook('preHandler', async (request, reply) => {
    //     // auth / routing logic / etc
    // })

    fastify.get('/_/phasty/ping', async (request, reply) => {
        await reply.send('pong')
    })

    fastify.all('*', async (request, reply) => {
        await handleRequest(request, reply)
    })

    /**
     * @param {FastifyRequest} request
     * @param {FastifyReply} reply
     */
    async function handleRequest(request, reply) {
        const processed = await handleStaticRequest(request, reply)
        if (processed) return

        if (phpHandler) {
            const processed = await handlePhpRequest(request, reply)
            if (processed) return
        }

        await reply.code(404).send('Not found')
    }

    /**
     * @param {FastifyRequest} request
     * @param {FastifyReply} reply
     */
    async function handleStaticRequest(request, reply) {
        const publicDirs = config.routing?.publicDirs ?? [process.cwd()]
        const urlPath = request.url.split('?')[0].split('#')[0]

        for (const dir of publicDirs) {
            try {
                const safePath = resolveSafePath(dir, urlPath)
                if (!safePath) continue

                if (!await fileExists(safePath)) continue

                await reply.sendFile(urlPath, dir)
                return true

            } catch (err) {
                logger.error(`Error serving static file: ${err.message}`)
                await reply.code(500).send('Internal Server Error')
                return true
            }
        }
        return false
    }

    /**
    * @param {FastifyRequest} request
    * @param {FastifyReply} reply
    */
    function handlePhpRequest(request, reply) {
        reply.from(request.url, {
            rewriteRequestHeaders(req, headers) {
                return {
                    ...headers,
                    'x-forwarded-for': req.ip,
                    'x-forwarded-host': headers.host,
                    'x-forwarded-proto': req.protocol,
                }
            }
        })
        return true
    }
}


