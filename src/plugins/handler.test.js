import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import Fastify from 'fastify'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import handlerPlugin from './handler.js'

describe('handlerPlugin static routing', () => {
    let root
    let app

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), 'phasty-handler-'))
        await mkdir(path.join(root, 'node_modules'), { recursive: true })
        await writeFile(path.join(root, 'app.js'), 'console.log("ok")')
        await writeFile(path.join(root, '.env'), 'APP_KEY=secret')
        await writeFile(path.join(root, 'node_modules', 'pkg.js'), 'secret')

        app = Fastify()
        await app.register(handlerPlugin, {
            config: {
                routing: {
                    publicDirs: [root],
                    denyRegex: ['^\\.', '^node_modules', '^vendor'],
                },
                php: {
                    extensions: ['php'],
                },
            },
            logger: {
                error() { },
            },
            phpHandler: null,
        })
    })

    afterEach(async () => {
        await app?.close()
        await rm(root, { recursive: true, force: true })
    })

    test('serves allowed files from configured public dirs', async () => {
        const response = await app.inject('/app.js')

        expect(response.statusCode).toBe(200)
        expect(response.body).toBe('console.log("ok")')
    })

    test('blocks denied paths before serving static files', async () => {
        const dotEnv = await app.inject('/.env')
        const dependency = await app.inject('/node_modules/pkg.js')

        expect(dotEnv.statusCode).toBe(404)
        expect(dependency.statusCode).toBe(404)
    })
})
