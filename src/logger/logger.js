import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

const transport = isDev
    ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'HH:MM:ss'
        }
    }
    : undefined

const logger = pino({
    level: 'debug',
    transport
})

export function getLogger() {
    return logger
}
