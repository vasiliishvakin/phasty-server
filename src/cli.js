import { createRequire } from 'node:module'
import { Command } from 'commander'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { ProcessManager } from './processManager.js'
import { createPhpArtisanService } from './services/phpArtisan.js'
import { createViteService } from './services/vite.js'
import { getLogger } from './logger/logger.js'
import { serviceLog, serviceUrl } from './logger/serviceLog.js'
import { getPort, buildUrl, resolveServerAddress } from './helpers.js'
import { createViteProxy } from './viteProxy.js'
import { ensureCert, loadTlsOptions } from './cert-manager.js'

const { version } = createRequire(import.meta.url)('../package.json')

export async function main(argv) {

    const program = new Command()

    program
        .name('phasty')
        .version(version)

    program
        .command('start', { isDefault: true })
        .description('Start the development server')
        .option('--port <n>', 'Fastify listen port (auto if not set)', parseInt)
        .option('--php-port <n>', 'PHP artisan serve port (auto if not set)', parseInt)
        .option('--php <path>', 'PHP binary path (default: php)')
        .option('--public-dir <dir>', 'Static files directory (default: public)')
        .option('--host <host>', 'Bind host (default: 0.0.0.0)')
        .action(async (opts) => {
            await commandStart(opts)
        })

    await program.parseAsync(argv)

}

function createShutdown({ manager, server, logger, timeout = 10000 } = {}) {
    return async function shutdown(signal) {
        const timer = setTimeout(() => {
            logger?.error('Shutdown timed out! Forcing exit...');
            process.exit(1);
        }, timeout);

        timer.unref();
        try {
            logger?.info(`Received ${signal}`);
            await server?.shutdown();
            await manager?.shutdown();
        } catch (err) {
            logger?.error(err);
            process.exit(1);
        } finally {
            process.exit(0);
        }
    }

}

async function commandStart(cliOpts) {

    const logger = getLogger()
    const config = await loadConfig(cliOpts)
    const manager = new ProcessManager(logger)

    let tlsOptions = null
    if (config.https?.enabled) {
        await ensureCert(config, logger)
        tlsOptions = await loadTlsOptions(config)
    }

    const tlsEnabled = !!tlsOptions

    if (tlsEnabled) {
        serviceLog('TLS enabled')
    } else {
        serviceLog('TLS not enabled')
    }

    const { port: { start: serverPortStart, stop: serverPortStop } } = config.server
    const serverPort = await getPort(serverPortStart, serverPortStop)

    const serverAddr = resolveServerAddress(config, serverPort, tlsEnabled)
    const serverUrl = serverAddr.buildUrl()

    let phpProcess = null
    let phpCleanup = async () => { }
    if (config.php?.enabled) {
        const phpService = await createPhpArtisanService(manager, config, tlsEnabled, serverPort)
        if (phpService) {
            phpProcess = phpService.start()
            phpCleanup = phpService.cleanup
        }
    }

    if (phpProcess) {
        serviceLog(`PHP server started, PID: ${phpProcess.pid}`)
    } else {
        serviceLog('PHP server not started')
    }

    const phpHandler = phpProcess ?
        {
            host: phpProcess.meta.host,
            port: phpProcess.meta.port
        } :
        null

    const server = await createServer({ config, logger, port: serverPort, phpHandler, tlsOptions })

    let viteProcess = null
    let viteProxy = null
    if (config.vite?.enabled) {
        const { port: vitePortRange } = config.vite
        const proxyPort = await getPort(vitePortRange.start, vitePortRange.stop)

        const viteService = await createViteService(manager, config, tlsEnabled, proxyPort)
        if (viteService) {
            viteProcess = viteService.start()
            serviceLog(`Vite started, PID: ${viteProcess.pid}`)
        } else {
            serviceLog('Vite not started')
        }

        if (viteProcess) {
            viteProxy = await createViteProxy({ config, logger, port: proxyPort, viteInternalPort: viteProcess.meta.port, tlsOptions })
        }
    }

    const shutdown = createShutdown({ manager, server, logger })
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, async () => {
            try {
                if (viteProxy) {
                    await viteProxy.shutdown();
                }
                await phpCleanup();
                await shutdown(signal);
            } catch (err) {
                logger.error(`\nShutdown failed: ${err.message}`);
                process.exit(1);
            }
        });
    }

    await server.start()
    await viteProxy?.start()

    serviceLog('')
    serviceUrl('Server:', serverUrl)

    if (viteProxy) {
        serviceUrl('Vite:  ', viteProxy.origin)
    }

    serviceLog('')
}