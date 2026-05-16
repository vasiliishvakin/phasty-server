import { describe, expect, test } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { patchDotEnv } from './phpArtisan.js'

const logger = {
    info() { },
    warn() { },
}

describe('patchDotEnv', () => {
    test('restores the original value after a normal cleanup', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'phasty-env-'))
        const envPath = path.join(dir, '.env')

        try {
            await writeFile(envPath, 'APP_URL=http://old.test\n')

            const cleanup = await patchDotEnv(envPath, 'APP_URL', 'https://new.test', logger)
            expect(await readFile(envPath, 'utf8')).toBe('# phasty: APP_URL=http://old.test\nAPP_URL=https://new.test\n')

            await cleanup()
            expect(await readFile(envPath, 'utf8')).toBe('APP_URL=http://old.test\n')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test('keeps the first original value across repeated patches', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'phasty-env-'))
        const envPath = path.join(dir, '.env')

        try {
            await writeFile(envPath, 'APP_URL=http://old.test\n')

            await patchDotEnv(envPath, 'APP_URL', 'https://first.test', logger)
            const cleanup = await patchDotEnv(envPath, 'APP_URL', 'https://second.test', logger)

            expect(await readFile(envPath, 'utf8')).toBe('# phasty: APP_URL=http://old.test\nAPP_URL=https://second.test\n')

            await cleanup()
            expect(await readFile(envPath, 'utf8')).toBe('APP_URL=http://old.test\n')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test('removes an appended value when the key did not exist', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'phasty-env-'))
        const envPath = path.join(dir, '.env')

        try {
            await writeFile(envPath, 'APP_NAME=Test\n')

            const cleanup = await patchDotEnv(envPath, 'APP_URL', 'https://new.test', logger)
            expect(await readFile(envPath, 'utf8')).toBe('APP_NAME=Test\nAPP_URL=https://new.test\n')

            await cleanup()
            expect(await readFile(envPath, 'utf8')).toBe('APP_NAME=Test\n')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })
})
