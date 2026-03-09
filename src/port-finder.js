import net from 'node:net'

export async function findFreePort(start = 8001) {
  for (let port = start; port < 65535; port++) {
    if (await isPortFree(port)) return port
  }
  throw new Error('No free port found')
}

function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '0.0.0.0')
  })
}

/**
 * Polls a TCP port until it accepts connections or attempts are exhausted.
 * @param {string} host
 * @param {number} port
 * @param {number} attempts
 * @param {number} delayMs
 * @returns {Promise<boolean>}
 */
export function waitTCP(host, port, attempts, delayMs) {
  return new Promise(resolve => {
    let remaining = attempts

    const tryConnect = () => {
      const socket = new net.Socket()
      socket.setTimeout(delayMs)

      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })

      socket.on('error', () => {
        socket.destroy()
        remaining--
        if (remaining <= 0) resolve(false)
        else setTimeout(tryConnect, delayMs)
      })

      socket.on('timeout', () => {
        socket.destroy()
        remaining--
        if (remaining <= 0) resolve(false)
        else setTimeout(tryConnect, delayMs)
      })

      socket.connect(port, host)
    }

    tryConnect()
  })
}
