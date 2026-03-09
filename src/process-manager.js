/**
 * Tracks running processes and Fastify instances for coordinated shutdown.
 * Call register() as resources come up, then shutdown() on SIGINT/SIGTERM.
 * Resources are stopped in reverse registration order.
 */
export class ProcessManager {
  /** @type {Array<{ name: string, handle: import('node:child_process').ChildProcess | import('fastify').FastifyInstance }>} */
  #handles = []

  /**
   * @param {string} name  Human-readable label for logging
   * @param {import('node:child_process').ChildProcess | import('fastify').FastifyInstance} handle
   * @returns {this}
   */
  register(name, handle) {
    this.#handles.push({ name, handle })
    return this
  }

  async shutdown() {
    process.stdout.write('\n')
    setTimeout(() => process.exit(0), 3000).unref()

    for (const { handle } of [...this.#handles].reverse()) {
      try {
        if (typeof handle.kill === 'function') {
          handle.kill()
        } else {
          handle.server?.closeAllConnections?.()
          await handle.close()
        }
      } catch {
        // ignore shutdown errors
      }
    }

    process.exit(0)
  }
}
