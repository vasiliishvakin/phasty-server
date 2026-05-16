import path from 'node:path'
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

    const publicDirs = (config.routing?.publicDirs?.length ? config.routing.publicDirs : [process.cwd()])
        .map(dir => path.resolve(dir))
    const phpExtensions = new Set(config.php?.extensions ?? ['php'])
    const denyRegex = (config.routing?.denyRegex ?? []).map(pattern => new RegExp(pattern))

    // register plugins
    if (phpHandler) {
        await fastify.register(replyFrom,
            {
                base: `http://${phpHandler.host}:${phpHandler.port}/`,
                undici: {
                    // headersTimeout: 5 * 60 * 1000,
                    // bodyTimeout: 5 * 60 * 1000,
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
        const urlPath = request.url.split('?')[0].split('#')[0]
        const ext = path.extname(urlPath).slice(1)

        if (isDenied(urlPath)) {
            await reply.code(404).send('Not found')
            return
        }

        if (phpHandler && phpExtensions.has(ext)) {
            await handlePhpRequest(request, reply)
            return
        }

        const processed = await handleStaticRequest(request, reply)
        if (processed) return

        if (phpHandler) {
            await handlePhpRequest(request, reply)
            if (reply.sent) return
        }

        await reply.code(404).send('Not found')
    }

    /**
     * @param {FastifyRequest} request
     * @param {FastifyReply} reply
     */
    async function handleStaticRequest(request, reply) {
        const urlPath = request.url.split('?')[0].split('#')[0]

        for (const dir of publicDirs) {
            try {
                const safePath = resolveSafePath(dir, urlPath)
                if (!safePath) continue

                if (!await fileExists(safePath)) continue

                await reply.sendFile(urlPath, dir)
                return true

            } catch (err) {
                logger.error(`Error serving static file from ${dir}: ${err.message}`)
            }
        }
        return false
    }

    /**
     * @param {string} urlPath
     * @returns {boolean}
     */
    function isDenied(urlPath) {
        const normalized = urlPath.replace(/^\/+/, '')
        return denyRegex.some(regex => regex.test(normalized) || regex.test(urlPath))
    }

    /**
    * @param {FastifyRequest} request
    * @param {FastifyReply} reply
    */
    function handlePhpRequest(request, reply) {
        return reply.from(request.url, {
            rewriteRequestHeaders(req, headers) {
                return {
                    ...headers,
                    'x-forwarded-for': req.ip,
                    'x-forwarded-host': req.headers.host,
                    'x-forwarded-proto': req.protocol,
                }
            }
        })
    }
}

