# phasty

Fastify-based development server with nginx-style `try_files` routing.

Designed primarily for Laravel, phasty serves static files from `public/`, proxies other requests to `php artisan serve`, and provides SPA fallback when no file matches. Optional Vite/HMR support and automatic HTTPS via Let's Encrypt + Cloudflare.

- serves static files from `public/`
- proxies other requests to `php artisan serve`
- SPA fallback: serves `index.html` when no artisan and no file matched
- optional Vite / HMR support
- optional HTTPS via Let's Encrypt + Cloudflare DNS

## Installation

```bash
npm install --save-dev phasty-server
```

## Usage

```bash
# from the Laravel project root
phasty start

# with manual ports
phasty start --port=8080 --php-port=8081

# help
phasty --help
phasty --version
```

## Options

| Option | Default | Description |
|---|---|---|
| `--port=N` | auto (>8000) | Fastify port |
| `--php-port=N` | auto (port+1) | `php artisan serve` port |
| `--php=path` | `php` | Path to PHP binary |
| `--public-dir=dir` | `public` | Static files directory |
| `--host=host` | `0.0.0.0` | Bind address |

## Configuration

Create `phasty.config.js` in the project root (or copy from `node_modules/phasty/stubs/`):

```js
export default {
  port: null,           // auto > 8000
  host: '0.0.0.0',
  phpPort: null,        // auto > port
  phpHost: '127.0.0.1',
  publicDir: 'public',
  php: 'php',

  https: false,
  domain: null,         // required if https: true
  wildcard: false,      // wildcard certificate (*.domain.com)
  email: null,          // required if https: true
  cloudflareIni: '~/.secrets/cloudflare.ini',

  vite: null,           // null = auto-detect via vite.config.js
  vitePort: null,       // public Vite proxy port
  viteInternalPort: null,
}
```

Priority: **CLI arguments > phasty.config.js > ~/.phasty.json > defaults**

## User config

Create `~/.phasty.json` for settings shared across all projects (e.g. PHP binary path, default host):

```json
{
  "php": "/usr/local/bin/php8.3",
  "host": "0.0.0.0",
  "cloudflareIni": "~/.secrets/cloudflare.ini"
}
```

Supports the same fields as `phasty.config.js`. Project config and CLI arguments always take precedence.

## Routing

```
GET /css/app.css        → public/css/app.css exists    → sendFile
GET /                   → public/index.html exists      → sendFile
GET /gallery/           → public/gallery/index.html     → sendFile
GET /login              → no file + artisan exists      → proxy → PHP
GET /api/users          → no file + artisan exists      → proxy → PHP
GET /unknown            → no file + no artisan          → public/index.html (SPA fallback)
```

## PHP

If an `artisan` file exists in the current directory, phasty automatically starts `php artisan serve`. Otherwise it works as a static / SPA server (requests that don't match a file are served `index.html` if it exists, or 404).

## Vite

Auto-detect: if `vite.config.js` or `vite.config.ts` exists in CWD, Vite starts automatically.

Phasty starts a separate proxy server for Vite (HTTP + WebSocket for HMR).

Add this to your `vite.config.js`:

```js
server: {
  origin: process.env.PHASTY_VITE_ORIGIN ?? 'http://localhost:5173',
  hmr: process.env.PHASTY_DOMAIN
    ? {
        protocol: 'wss',
        host: process.env.PHASTY_DOMAIN,
        clientPort: parseInt(process.env.PHASTY_VITE_PORT ?? '5173'),
      }
    : true,
}
```

Environment variables phasty passes to Vite:

| Variable | Example |
|---|---|
| `PHASTY_VITE_ORIGIN` | `https://example.com:5173` |
| `PHASTY_DOMAIN` | `example.com` |
| `PHASTY_VITE_PORT` | `5173` |

## HTTPS

Requires: `certbot`, `certbot-dns-cloudflare` plugin, `~/.secrets/cloudflare.ini` file.

```js
// phasty.config.js
export default {
  https: true,
  domain: 'example.com',
  email: 'admin@example.com',
  wildcard: true,  // issues *.example.com + example.com
  cloudflareIni: '~/.secrets/cloudflare.ini',
}
```

On startup phasty:
- if no certificate exists — obtains one via `certbot certonly --dns-cloudflare`
- if expiry < 30 days — renews via `certbot renew`
- certificates are read from `/etc/letsencrypt/live/<domain>/`

## Startup output

```
  phasty  http://localhost:8001  (laravel + vite)

  ✓  server    http://0.0.0.0:8001
  ✓  public    /var/www/myproject/public
  ✓  php       http://127.0.0.1:8002
  ✓  vite      http://0.0.0.0:8003  →  127.0.0.1:8004
  ✗  https     disabled
```

HTTPS with domain:

```
  phasty  https://example.com  (laravel + vite)

  ✓  server    https://0.0.0.0:443
  ✓  public    /var/www/myproject/public
  ✓  php       http://127.0.0.1:8001
  ✓  vite      https://0.0.0.0:8002  →  127.0.0.1:8003
  ✓  https     example.com
```

## Requirements

- Node.js 18+
- Linux (Debian/Ubuntu)
- PHP (for Laravel mode)
- certbot + certbot-dns-cloudflare (for HTTPS)

## Source code

```
bin/phasty.js              entry point (shebang wrapper → src/cli.js)

src/cli.js                 Commander CLI: start / init / doctor commands;
                           orchestrates all subsystems (config → cert → vite
                           → php → fastify), prints startup summary, updates
                           APP_URL in .env

src/config.js              loads and merges config (CLI > phasty.config.js >
                           ~/.phasty.json > defaults), validates with valibot,
                           auto-detects artisan / vite, allocates free ports

src/server.js              main Fastify server: try_files routing
                           (static file → PHP proxy → SPA fallback),
                           HTTP/2 + HTTPS support

src/vite-proxy.js          separate Fastify proxy for Vite + WebSocket HMR;
                           sits in front of the internal vite --host 127.0.0.1

src/process-manager.js     ProcessManager — tracks child processes and Fastify
                           instances, shuts them down in reverse order on
                           SIGINT/SIGTERM

src/cert-manager.js        TLS certificate lifecycle via certbot + Cloudflare
                           DNS: obtain, renew (<30 days left), read from
                           /etc/letsencrypt/

src/port-finder.js         findFreePort() — scans for a free TCP port from a
                           given start; waitTCP() — polls until a service is up

src/logger.js              Pino logger: pino-pretty for TTY, plain JSON otherwise

src/doctor.js              `phasty doctor` command: a list of checks (Vite /
                           Laravel / HTTPS), each returning ok/warn/fail/skip

src/types.js               JSDoc typedef for PhastyConfig (types only)
```

### Tests

```
npm test                              run all tests
npx vitest run test/foo.test.js       run a single file
```

```
test/server.integration.test.js       integration: real Fastify + mock PHP server
test/cli.test.js                      CLI commands
test/config.test.js                   config loading / merging / validation
test/port-finder.test.js              findFreePort / waitTCP
test/helpers/mock-php-server.js       minimal HTTP server standing in for artisan
```
