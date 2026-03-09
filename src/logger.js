import pino from 'pino'

/** @returns {import('pino').Logger} */
export function createLogger() {
  if (process.stdout.isTTY) {
    return pino({
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,reqId,source', messageFormat: '[phasty] {msg}' },
      },
    })
  }
  return pino()
}

/** @type {import('pino').Logger} */
export const logger = createLogger()
