/**
 * Raw user-facing config (from phasty.config.js or CLI args).
 * All fields optional — merged with DEFAULTS before use.
 *
 * @typedef {Object} RawConfig
 * @property {string} [host]
 * @property {number|null} [port]
 * @property {string} [phpHost]
 * @property {number|null} [phpPort]
 * @property {string} [publicDir]
 * @property {boolean} [https]
 * @property {boolean} [http2]
 * @property {string|null} [domain]
 * @property {string|null} [email]
 * @property {string} [php]
 * @property {string|null} [wildcard]
 * @property {string} [cloudflareIni]
 * @property {boolean|null} [vite]
 * @property {number|null} [vitePort]
 * @property {number|null} [viteInternalPort]
 */

/**
 * Fully resolved config passed to startServer, startViteProxy, etc.
 *
 * @typedef {Object} PhastyConfig
 * @property {string} host
 * @property {number} port
 * @property {string} phpHost
 * @property {number} phpPort
 * @property {string} publicDir
 * @property {boolean} https
 * @property {boolean} http2
 * @property {string|null} domain
 * @property {string|null} email
 * @property {string} php
 * @property {string|null} wildcard
 * @property {string|null} fqdn
 * @property {string} cloudflareIni
 * @property {boolean} vite
 * @property {number} vitePort
 * @property {number} viteInternalPort
 * @property {boolean} artisan
 * @property {boolean} publicDirFallback
 */

export {}
