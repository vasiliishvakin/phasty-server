// @ts-check
import { execa } from 'execa'
/**
 * @typedef {ReturnType<typeof import('./logger/logger.js').getLogger>} Logger
 */


/**
 * @param {Logger} logger
 * @returns {{
 *   run: (
 *     cmd: string,
 *     args?: string[],
 *     opts?: import('execa').Options
 *   ) => Promise<import('execa').Result>
 * }}
 */
export function getRunner(logger) {
    return {
        async run(cmd, args = [], opts = {}) {
            const commandStr = [cmd, ...args].join(' ')
            logger.info({ cmd, args }, `Running: ${commandStr}`)

            try {
                const result = await execa(cmd, args, {
                    stdio: 'inherit',
                    ...opts
                })

                logger.info(`Done: ${cmd}`)
                return result
            } catch (err) {
                logger.error({ err, cmd, args }, `Failed: ${commandStr}`)
                throw err
            }
        }
    }
}
