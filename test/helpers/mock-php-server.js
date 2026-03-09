import http from 'node:http'

const defaultHandler = (req, res) => {
  if (req.url === '/error-test') {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('PHP Error')
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(`PHP: ${req.url}`)
}

/**
 * Starts a mock HTTP server (PHP upstream substitute).
 * Listens on a random port on 127.0.0.1.
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} [handler]
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function createMockPhpServer(handler) {
  const server = http.createServer(handler ?? defaultHandler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    port,
    close: () => new Promise(resolve => server.close(resolve))
  }
}
