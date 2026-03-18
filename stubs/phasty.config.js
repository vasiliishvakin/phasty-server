export default {
  server: {
    host: '0.0.0.0',
    port: null,             // auto-assigned if not set
  },

  routing: {
    publicDirs: ['public'], // directories checked for static files, in order
    // denyRegex: ['^\.', '^node_modules', '^vendor'],
  },

  php: {
    enabled: false,
    bin: 'php',
    host: '127.0.0.1',
    port: { start: 8000 }, // stop: 8100 to allow a range
    // workers: 4,
    // extensions: ['php'],
  },

  vite: {
    enabled: false,
    bin: 'npm',
    script: 'dev',
    host: '0.0.0.0',
    port: { start: 5173 },           // external proxy port
    instance: {
      host: '127.0.0.1',
      port: { start: 5174 },         // internal vite process port
    },
  },

  https: {
    enabled: false,
    // domain: 'example.com',        // required when enabled
    // cert: {
    //   email: 'admin@example.com', // required when enabled
    //   certDomain: '*.example.com',
    //   dns: {
    //     provider: 'cloudflare',
    //     credentialsFile: '~/.secrets/cloudflare.ini',
    //   },
    // },
  },
}
