import { getLogger } from './logger.js'
import { randomUUID } from 'node:crypto'

export function createRequestLogger(request) {
    return getLogger().child({
        requestId: randomUUID(),
        method: request.method,
        url: request.url
    })
}
