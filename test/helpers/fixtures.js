import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Creates a temp directory with the given files.
 * @param {Record<string, string>} files - map of relative path → content
 * @returns {{ dir: string, cleanup: () => Promise<void> }}
 */
export async function createFixtures(files = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'phasty-test-'))
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(dir, relPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content)
  }
  return {
    dir,
    cleanup: () => fs.rm(dir, { recursive: true, force: true })
  }
}
