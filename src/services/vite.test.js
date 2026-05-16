import { afterEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createViteService } from './vite.js'

describe('createViteService', () => {
    const originalCwd = process.cwd()
    let root

    afterEach(async () => {
        process.chdir(originalCwd)
        await rm(root, { recursive: true, force: true })
    })

    test('sets PHASTY_* env vars', async () => {
        root = await mkdtemp(path.join(os.tmpdir(), 'phasty-vite-'))
        await writeFile(path.join(root, 'package.json'), '{}')
        process.chdir(root)

        let captured
        const manager = {
            run(cmd, args, opts, meta) {
                captured = { cmd, args, opts, meta }
                return { pid: 123, meta }
            }
        }

        const service = await createViteService(manager, {
            server: {
                host: '0.0.0.0',
            },
            vite: {
                enabled: true,
                bin: 'npm',
                script: 'dev',
                instance: {
                    host: '127.0.0.1',
                    port: {
                        start: 8300,
                    },
                },
            },
        }, false, 8200)

        service.start()

        expect(captured.opts.env.PHASTY_VITE_ORIGIN).toBe('http://localhost:8200')
        expect(captured.opts.env.PHASTY_VITE_PORT).toBe('8200')
        expect(captured.opts.env.PHASTY_HOST).toBe('0.0.0.0')
        expect(captured.opts.env.PROXY_HOST).toBeUndefined()
        expect(captured.opts.env.PROXY_PORT).toBeUndefined()
    })
})
