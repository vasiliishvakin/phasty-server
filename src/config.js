import { z } from 'zod'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { deepmergeCustom } from 'deepmerge-ts'
import { parse as parseYaml } from 'yaml'
import { isCovered } from './helpers.js'

/**
 * Resolves a possibly-partial domain to a full FQDN.
 * If `domain` contains no dot and `certDomain` is a wildcard (e.g. `*.example.com`),
 * builds `domain.example.com`. Otherwise returns `domain` as-is.
 * @param {string} domain
 * @param {string} certDomain
 * @returns {string}
 */
export function resolveDomain(domain, certDomain) {
    if (!domain.includes('.') && certDomain.startsWith('*.')) {
        return `${domain}.${certDomain.slice(2)}`
    }
    return domain
}

const merge = deepmergeCustom({
    mergeArrays: false
})

export const ConfigSchema = z.object({
    server: z.object({
        host: z.string().default('0.0.0.0'),
        port: z.object({
            start: z.number().int().min(1).max(65535).default(8000),
            stop: z.number().int().min(1).max(65535).optional(),
        }).prefault({}),
    }).prefault({}),

    routing: z.object({
        publicDirs: z.array(z.string()).optional(),
        denyRegex: z.array(z.string()).default(['^\\.', '^node_modules', '^vendor']),
    }).prefault({}),

    php: z.object({
        enabled: z.boolean().default(false),
        bin: z.string().default('php'),
        host: z.string().default('127.0.0.1'),
        workers: z.coerce.number().int().positive().optional(),
        port: z.object({
            start: z.number().int().min(1).max(65535).default(8100),
            stop: z.number().int().min(1).max(65535).optional(),
        })
            .refine(({ start, stop }) => stop === undefined || stop >= start, {
                message: 'port.stop must be >= port.start',
            })
            .prefault({}),
        extensions: z.array(z.string()).default(['php']),
    }).prefault({}),

    vite: z.object({
        enabled: z.boolean().default(false),
        bin: z.string().default('npm'),
        script: z.string().default('dev'),
        host: z.string().default('0.0.0.0'),
        port: z.object({
            start: z.number().int().min(1).max(65535).default(8200),
            stop: z.number().int().min(1).max(65535).optional(),
        }).prefault({}),
        instance: z.object({
            host: z.string().default('127.0.0.1'),
            port: z.object({
                start: z.number().int().min(1).max(65535).default(8300),
                stop: z.number().int().min(1).max(65535).optional(),
            }).prefault({}),
        }).prefault({}),
    }).prefault({}),

    https: z.object({
        enabled: z.boolean().default(false),

        domain: z.string().min(1).optional(),

        cert: z.object({
            email: z.email().optional(),

            certDomain: z.string().min(1).optional(),

            dns: z.object({
                provider: z.literal('cloudflare').default('cloudflare'),
                credentialsFile: z.string().default('~/.secrets/cloudflare.ini'),
            }).prefault({}),
        }).optional(),
    })
        .prefault({})
        .superRefine((val, ctx) => {
            if (!val.enabled) return

            if (!val.domain) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['domain'],
                    message: 'https.domain is required when https.enabled = true',
                })
            }

            if (!val.cert?.email) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['cert', 'email'],
                    message: 'https.cert.email is required when https.enabled = true',
                })
            }

            if (val.cert?.certDomain && val.domain && val.domain.includes('.')) {
                if (!isCovered(val.domain, val.cert.certDomain)) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['cert', 'certDomain'],
                        message: 'certDomain does not cover domain',
                    })
                }
            }
        })
        .transform(val => {
            if (!val.domain || !val.cert?.certDomain) return val
            return { ...val, domain: resolveDomain(val.domain, val.cert.certDomain) }
        })
})

/**
 * @typedef {import('zod').infer<typeof ConfigSchema>} Config
 */

async function loadHomeConfig() {
    const file = path.join(os.homedir(), '.phasty.yaml')

    if (!fs.existsSync(file)) return {}

    try {
        return parseYaml(fs.readFileSync(file, 'utf8')) ?? {}
    } catch (e) {
        console.error(`Invalid YAML in ${file}: ${e.message}`)
        process.exit(1)
    }
}

async function loadProjectConfig() {
    const file = path.resolve('phasty.config.js')

    if (!fs.existsSync(file)) return {}

    const mod = await import(file)
    return mod.default ?? mod
}

function normalizeCli(cli) {
    return {
        server: {
            port: cli.port ? { start: cli.port } : undefined,
            host: cli.host
        },
        php: {
            port: cli.phpPort ? { start: cli.phpPort } : undefined,
            bin: cli.php
        },
        routing: {
            publicDirs: cli.publicDir ? [cli.publicDir] : undefined
        }
    }
}

async function loadSources(cli) {
    const [home, project] = await Promise.all([
        loadHomeConfig(),
        loadProjectConfig(),
    ])

    return {
        home: home ?? {},
        project: project ?? {},
        cli: normalizeCli(cli) ?? {}
    }
}

function mergeConfig({ home, project, cli }) {
    return merge(home, project, cli)
}

function validateConfig(config) {
    const result = ConfigSchema.safeParse(config)

    if (!result.success) {
        const { fieldErrors } = z.flattenError(result.error)

        console.error('Invalid configuration:')
        console.error(JSON.stringify(fieldErrors, null, 2))
        process.exit(1)
    }

    return result.data
}

export async function loadConfig(cli = {}) {

    const sources = await loadSources(cli)

    const merged = mergeConfig(sources)

    const config = validateConfig(merged)

    return config
}