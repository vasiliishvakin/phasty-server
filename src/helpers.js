import path from 'node:path'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import getPortLib, { portNumbers } from 'get-port'


export async function pathExists(path) {
    try {
        await access(path, constants.F_OK)
        return true
    } catch {
        return false
    }
}

export async function fileExists(path) {
    try {
        return (await stat(path)).isFile()
    } catch {
        return false
    }
}

export function resolveSafePath(baseDir, urlPath) {
    const fullPath = path.normalize(path.join(baseDir, urlPath))
    const relative = path.relative(baseDir, fullPath)

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null
    }

    return fullPath
}


const lockedPorts = new Set()

let lock = Promise.resolve()

function findPort(start, stop) {
    return stop === undefined
        ? getPortLib({ port: start })
        : getPortLib({ port: portNumbers(start, stop) })
}

/**
 * @param {number} start
 * @param {number} [stop]
 * @returns {Promise<number>}
 */
export function getPort(start, stop) {
    const next = lock.then(async () => {
        let port
        let attempts = 0
        const maxAttempts = 50

        do {
            if (attempts++ >= maxAttempts) {
                throw new Error(
                    `Failed to allocate port after ${maxAttempts} attempts (range: ${start}-${stop ?? start})`
                )
            }

            port = await findPort(start, stop)
        } while (lockedPorts.has(port))

        lockedPorts.add(port)

        return port
    })

    lock = next.catch(() => { })

    return next
}

/**
 * @param {'http'|'https'} scheme
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
export function buildUrl(scheme, host, port) {
    const displayHost = (host === '0.0.0.0' || host === '::') ? 'localhost' : host
    const defaultPort = scheme === 'https' ? 443 : 80
    const portSuffix = port === defaultPort ? '' : `:${port}`
    return `${scheme}://${displayHost}${portSuffix}`
}

export function isCovered(fqdn, certDomain) {
    if (certDomain.startsWith('*.')) {
        const base = certDomain.slice(2)
        return fqdn === base || fqdn.endsWith(`.${base}`)
    }
    return fqdn === certDomain || fqdn.endsWith(`.${certDomain}`)
}
