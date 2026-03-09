import Fastify from 'fastify'
import httpProxy from '@fastify/http-proxy'
import { loadTlsOptions } from './cert-manager.js'

/** @typedef {import('./types.js').PhastyConfig} PhastyConfig */

/**
 * @param {PhastyConfig} config
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startViteProxy(config) {
  const { https: httpsEnabled, domain, vitePort, viteInternalPort } = config

  const fastify = Fastify({
    https: httpsEnabled ? loadTlsOptions(config) : undefined,
    logger: false,
  })

  const protocol = httpsEnabled ? 'https' : 'http'
  const mainOrigin = config.fqdn
    ? `${protocol}://${config.fqdn}:${config.port}`
    : `${protocol}://localhost:${config.port}`

  await fastify.register(httpProxy, {
    upstream: `http://127.0.0.1:${viteInternalPort}`,
    websocket: true,
    replyOptions: {
      rewriteHeaders: (headers) => {
        if (headers['access-control-allow-origin']) {
          headers['access-control-allow-origin'] = mainOrigin
        }
        return headers
      },
    },
  })

  await fastify.listen({ port: vitePort, host: '0.0.0.0' })
  return fastify
}
