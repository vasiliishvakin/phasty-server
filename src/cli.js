import { spawn } from 'node:child_process'
import { readFile, writeFile, access } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import pc from 'picocolors'
import { loadConfig } from './config.js'
import { ensureCert } from './cert-manager.js'
import { startServer } from './server.js'
import { startViteProxy } from './vite-proxy.js'
import { waitTCP } from './port-finder.js'
import { ProcessManager } from './process-manager.js'
import { runDoctor } from './doctor.js'

/** @typedef {import('./types.js').PhastyConfig} PhastyConfig */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export async function main(argv) {
  const program = new Command()

  program
    .name('phasty')
    .description('Fastify dev-server for Laravel — nginx try_files analogue')
    .version(pkg.version, '-v, --version', 'print version')
    .helpOption('-h, --help', 'display help')
    .configureOutput({
      writeOut: (str) => console.log(str.trimEnd()),
      writeErr: () => {}, // we handle errors ourselves in the catch block
    })
    .exitOverride()

  program
    .command('start')
    .description('Start the development server (default)')
    .option('--port <n>', 'Fastify listen port (auto if not set)', parseInt)
    .option('--php-port <n>', 'PHP artisan serve port (auto if not set)', parseInt)
    .option('--php <path>', 'PHP binary path (default: php)')
    .option('--public-dir <dir>', 'Static files directory (default: public)')
    .option('--host <host>', 'Bind host (default: 0.0.0.0)')
    .action(async (opts) => {
      await commandStart({
        port: opts.port,
        phpPort: opts.phpPort,
        php: opts.php,
        publicDir: opts.publicDir,
        host: opts.host,
      })
    })

  program
    .command('init')
    .description('Create phasty.config.js in current directory')
    .action(async () => {
      await commandInit()
    })

  program
    .command('doctor')
    .description('Check vite/laravel configuration and report recommendations')
    .action(async () => {
      await runDoctor()
    })

  // Empty argv → show help
  if (argv.length === 0) {
    program.outputHelp()
    return
  }

  // Bare flags without an explicit command → treat as `start`
  const effectiveArgv =
    argv[0].startsWith('-') && !['--help', '-h', '--version', '-v'].includes(argv[0])
      ? ['start', ...argv]
      : argv

  try {
    await program.parseAsync(effectiveArgv, { from: 'user' })
  } catch (err) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') return
    // Any other CommanderError (unknown command, invalid option, etc.)
    if (err.name === 'CommanderError') {
      console.error(`phasty: ${err.message.replace(/^error:\s*/i, '')}`)
      console.error('Run phasty --help for usage')
      process.exit(1)
    }
    throw err
  }
}

/** @param {Partial<PhastyConfig>} cliArgs */
async function commandStart(cliArgs) {
  // 1. Load and resolve config
  const config = await loadConfig(cliArgs)

  // 2. HTTPS: ensure certificate
  if (config.https) {
    await ensureCert(config)
  }

  // 2.5. Update APP_URL in .env if Laravel project
  if (config.artisan) {
    await updateDotEnvAppUrl(config)
  }

  const pm = new ProcessManager()
  const shutdown = () => pm.shutdown()

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // 3. Vite: start if enabled
  if (config.vite) {
    const protocol = config.https ? 'https' : 'http'
    const origin = config.fqdn
      ? `${protocol}://${config.fqdn}:${config.vitePort}`
      : `http://localhost:${config.vitePort}`

    const viteArgs = ['vite', '--port', String(config.viteInternalPort), '--host', '127.0.0.1']
    console.log(pc.dim(`$ npx ${viteArgs.join(' ')}`))
    const viteProc = spawn('npx', viteArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        PHASTY_VITE_ORIGIN: origin,
        PHASTY_DOMAIN: config.fqdn ?? '',
        PHASTY_VITE_PORT: String(config.vitePort),
      }
    })

    viteProc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(pc.red(`phasty: vite exited with code ${code}`))
        shutdown()
      }
    })

    pm.register('vite-proc', viteProc)

    const viteReady = await waitTCP('127.0.0.1', config.viteInternalPort, 10, 300)
    if (!viteReady) {
      console.error(pc.red('phasty: vite did not start in time'))
      process.exit(1)
    }

    // 4. Start Vite proxy
    const viteProxy = await startViteProxy(config)
    pm.register('vite-proxy', viteProxy)
  }

  // 5. PHP: start if artisan exists
  if (config.artisan) {
    const artisanArgs = ['artisan', 'serve', '--host', '127.0.0.1', '--port', String(config.phpPort)]
    console.log(pc.dim(`$ ${config.php} ${artisanArgs.join(' ')}`))
    const phpProc = spawn(config.php, artisanArgs, {
      stdio: 'inherit'
    })

    phpProc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(pc.red(`phasty: php artisan serve exited with code ${code}`))
        process.exit(1)
      }
    })

    pm.register('php-proc', phpProc)

    const phpReady = await waitTCP('127.0.0.1', config.phpPort, 10, 300)
    if (!phpReady) {
      console.error(pc.red('phasty: php artisan serve did not start in time'))
      process.exit(1)
    }
  }

  // 6. Start main Fastify server
  const fastify = await startServer(config)
  pm.register('fastify', fastify)

  // 7. Print startup info
  printStartupInfo(config)
}

async function commandInit() {
  const dest = path.join(process.cwd(), 'phasty.config.js')
  const exists = await access(dest).then(() => true).catch(() => false)

  if (exists) {
    console.error('phasty: phasty.config.js already exists')
    process.exit(1)
  }

  const content = await readFile(new URL('../stubs/phasty.config.js', import.meta.url), 'utf8')
  await writeFile(dest, content, 'utf8')
  console.log('phasty: created phasty.config.js')
}

/** @param {PhastyConfig} config */
function printStartupInfo(config) {
  const protocol = config.https ? 'https' : 'http'
  const serverUrl = config.fqdn
    ? `${protocol}://${config.fqdn}`
    : `${protocol}://localhost:${config.port}`

  let mode
  if (config.artisan && config.vite) mode = 'laravel + vite'
  else if (config.artisan) mode = 'laravel'
  else mode = 'static'

  const check = (ok) => ok ? pc.green('✓') : pc.dim('✗')
  const dim = pc.dim

  const lines = [
    '',
    `  ${pc.bold(pc.green('phasty'))}  ${pc.bold(serverUrl)}  ${dim(`(${mode})`)}`,
    '',
    `  ${check(true)}  ${pc.bold('server')}    ${protocol}://${config.fqdn ?? config.host}:${config.port}`,
  ]

  const publicLabel = config.publicDirFallback ? dim('(fallback: CWD)') : ''
  lines.push(`  ${check(true)}  ${pc.bold('public')}    ${path.resolve(config.publicDir)} ${publicLabel}`)

  if (config.artisan) {
    lines.push(`  ${check(true)}  ${pc.bold('php')}       http://${config.phpHost}:${config.phpPort}`)
  } else {
    lines.push(`  ${check(false)}  ${pc.bold('php')}       ${dim('not found')}`)
  }

  if (config.vite) {
    lines.push(`  ${check(true)}  ${pc.bold('vite')}      ${protocol}://${config.fqdn ?? config.host}:${config.vitePort}  ${dim('→')}  127.0.0.1:${config.viteInternalPort}`)
  } else {
    lines.push(`  ${check(false)}  ${pc.bold('vite')}      ${dim('not detected')}`)
  }

  if (config.https) {
    lines.push(`  ${check(true)}  ${pc.bold('https')}     ${config.fqdn}`)
  } else {
    lines.push(`  ${check(false)}  ${pc.bold('https')}     ${dim('disabled')}`)
  }

  lines.push('')
  console.log(lines.join('\n'))
}

/** @param {PhastyConfig} config */
async function updateDotEnvAppUrl(config) {
  const envPath = path.join(process.cwd(), '.env')
  let content
  try {
    content = await readFile(envPath, 'utf8')
  } catch {
    return // no .env — skip
  }

  const protocol = config.https ? 'https' : 'http'
  const appUrl = config.fqdn
    ? `${protocol}://${config.fqdn}:${config.port}`
    : `${protocol}://localhost:${config.port}`

  const updated = content.replace(/^APP_URL=.*/m, `APP_URL=${appUrl}`)
  if (updated === content) return // no change

  await writeFile(envPath, updated, 'utf8')
  console.log(pc.dim(`phasty: .env APP_URL set to ${appUrl}`))
}
