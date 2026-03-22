import { execa } from 'execa'

export class ProcessManager {

    constructor(logger) {
        this.processes = []
        this.logger = logger
    }

    /**
     * @param {string} cmd
     * @param {string[]} [args]
     * @param {import('execa').Options} [opts]
     * @param {object} [meta] - Optional info about the process to be used in different purposes
     * @returns {import('execa').ResultPromise}
     */
    run(cmd, args = [], opts = {}, meta = {}) {
        const child = execa(cmd, args, {
            stdio: 'inherit',
            ...opts
        })

        this.processes.push(child)

        child.finally(() => {
            this.processes = this.processes.filter(p => p !== child)
        }).catch(() => {})

        child.meta = { ...meta, cmd, args, opts }

        return child
    }

    async shutdown() {
        await Promise.allSettled(
            this.processes.map(async p => {
                if (!p.killed) {
                    p.kill(p.meta.killSignal ?? 'SIGTERM')
                }

                const timeout = setTimeout(() => {
                    if (!p.killed) p.kill('SIGKILL')
                }, 5000)

                try {
                    await p
                } catch { }

                clearTimeout(timeout)

                this.logger?.info(`Process ${p.pid} exited with code ${p.exitCode}`)
            })
        )
    }
}
