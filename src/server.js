import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import replyFrom from '@fastify/reply-from'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadTlsOptions } from './cert-manager.js'
import { logger } from './logger.js'

/** @typedef {import('./types.js').PhastyConfig} PhastyConfig */

/**
 * @param {PhastyConfig} config
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startServer(config) {
  const { host, port, phpHost, phpPort, publicDir, https: httpsEnabled, http2: http2Enabled, domain } = config

  const fastify = Fastify({
    http2: http2Enabled ? true : undefined,
    https: httpsEnabled ? loadTlsOptions(config) : undefined,
    http2SessionTimeout: 0,  // disable idle session timeout (long PHP requests)
    disableRequestLogging: true,
    loggerInstance: logger,
  })

  fastify.addHook('onResponse', (req, reply, done) => {
    const ms = reply.elapsedTime.toFixed(1)
    req.log.info(`${req.method} ${req.url} ${reply.statusCode} ${ms}ms`)
    done()
  })

  fastify.setErrorHandler((error, req, reply) => {
    const abortCodes = ['UND_ERR_ABORTED', 'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ERR_HTTP2_STREAM_CANCEL']
    if (abortCodes.includes(error.code)) {
      req.log.warn({ err: error }, 'proxy connection error')
      if (!reply.sent) reply.code(502).send('Bad Gateway')
      return
    }
    req.log.error({ err: error }, 'unhandled error')
    if (!reply.sent) reply.code(500).send('Internal Server Error')
  })

  await fastify.register(replyFrom, {
    base: `http://${phpHost}:${phpPort}`,
    undici: {
      headersTimeout: 10 * 60 * 1000,  // 10 min
      bodyTimeout: 10 * 60 * 1000,     // 10 min
      keepAliveTimeout: 10 * 60 * 1000, // 10 min
    },
  })

  await fastify.register(fastifyStatic, {
    root: path.resolve(publicDir),
    prefix: '/',
    serve: false
  })

  fastify.get('/phasty/ping', async (req, reply) => {
    return reply.send('pong')
  })

  fastify.all('/*', async (req, reply) => {
    const pathname = decodeURIComponent(new URL(req.raw.url, 'http://localhost').pathname)

    const candidates = [
      pathname,
      pathname.replace(/\/?$/, '/index.html')
    ]

    for (const candidate of candidates) {
      if (await fileExists(publicDir, candidate)) {
        return reply.sendFile(candidate.slice(1))
      }
    }

    if (!config.phpPort) {
      if (await fileExists(publicDir, '/index.html')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send('Not found')
    }

    return reply.from(req.url, {
      rewriteRequestHeaders: (_req, headers) => {
        const host = req.headers.host || req.headers[':authority']
        headers['host'] = host
        headers['x-forwarded-proto'] = httpsEnabled ? 'https' : 'http'
        headers['x-forwarded-host'] = host
        headers['x-forwarded-for'] = req.ip
        return headers
      },
      rewriteHeaders: (headers) => {
        // HTTP/1.1 hop-by-hop headers are forbidden in HTTP/2
        if (http2Enabled) {
          const forbidden = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']
          for (const h of forbidden) delete headers[h]
        }
        return headers
      },
    })
  })

  await fastify.listen({ port, host })
  fastify.server.setTimeout(0) // disable socket timeout for long-running PHP requests
  return fastify
}

async function fileExists(publicDir, urlPath) {
  const root = path.resolve(publicDir)
  const filePath = path.resolve(root, '.' + urlPath)

  if (!filePath.startsWith(root)) return false  // path traversal guard

  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}
