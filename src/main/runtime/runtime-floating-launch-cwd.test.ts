import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ fakeHome: '' }))

// The server resolves `~` against ITS home. Point that at a temp dir so these tests prove
// the expansion uses the runtime server's home and nothing about the caller's machine.
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  homedir: () => hoisted.fakeHome
}))

import {
  RuntimeServerEnvironmentCommands,
  isFloatingTerminalSelector,
  resolveFloatingLaunchCwd
} from './runtime-server-environment-commands'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-floating-cwd-'))
  hoisted.fakeHome = join(root, 'server-home')
  mkdirSync(join(hoisted.fakeHome, 'workspaces'), { recursive: true })
  writeFileSync(join(hoisted.fakeHome, 'a-file.txt'), 'x')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// The contract the web client's getFloatingTerminalCwd relies on (files.browseServerDir): the web
// resolver returns `resolvedPath` verbatim, so this is what makes it the SERVER's directory.
describe('RuntimeServerEnvironmentCommands.browseDirectory (web floating cwd contract)', () => {
  const commands = new RuntimeServerEnvironmentCommands()

  it('resolves ~/workspaces to an absolute path under the server home', async () => {
    const listing = await commands.browseDirectory('~/workspaces')
    expect(listing.resolvedPath).toBe(join(hoisted.fakeHome, 'workspaces'))
    expect(listing.pathFlavor).toBe(process.platform === 'win32' ? 'win32' : 'posix')
  })

  it('resolves ~ to the server home', async () => {
    expect((await commands.browseDirectory('~')).resolvedPath).toBe(hoisted.fakeHome)
  })

  it('rejects a missing directory, which the web resolver turns into a visible fallback', async () => {
    await expect(commands.browseDirectory('~/does-not-exist')).rejects.toThrow()
  })

  it('rejects a path that is a file', async () => {
    await expect(commands.browseDirectory('~/a-file.txt')).rejects.toThrow(/not a directory/)
  })
})

describe('resolveFloatingLaunchCwd', () => {
  it('expands ~/workspaces against the server home to an absolute path', async () => {
    const resolved = await resolveFloatingLaunchCwd('~/workspaces')
    expect(resolved).toBe(join(hoisted.fakeHome, 'workspaces'))
    // The launch path joins non-absolute cwds onto home, so a literal "~" segment must never survive.
    expect(resolved).not.toContain('~')
  })

  it('maps ~ to the server home', async () => {
    expect(await resolveFloatingLaunchCwd('~')).toBe(hoisted.fakeHome)
  })

  it('accepts an existing absolute directory unchanged', async () => {
    const dir = join(hoisted.fakeHome, 'workspaces')
    expect(await resolveFloatingLaunchCwd(dir)).toBe(dir)
  })

  it.each([undefined, '', '   '])('returns undefined for an absent request (%j)', async (value) => {
    expect(await resolveFloatingLaunchCwd(value)).toBeUndefined()
  })

  it('returns undefined for a missing directory instead of throwing', async () => {
    expect(await resolveFloatingLaunchCwd('~/does-not-exist')).toBeUndefined()
  })

  it('returns undefined when the path is a file, not a directory', async () => {
    expect(await resolveFloatingLaunchCwd('~/a-file.txt')).toBeUndefined()
  })

  it('returns undefined for a path with a null byte', async () => {
    expect(await resolveFloatingLaunchCwd('~/work\0spaces')).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'returns undefined for a directory the server cannot read',
    async () => {
      const locked = join(hoisted.fakeHome, 'locked')
      mkdirSync(locked)
      chmodSync(locked, 0o000)
      try {
        expect(await resolveFloatingLaunchCwd('~/locked')).toBeUndefined()
      } finally {
        chmodSync(locked, 0o700)
      }
    }
  )
})

describe('isFloatingTerminalSelector', () => {
  it('accepts exactly the bare sentinel and its id: selector', () => {
    expect(isFloatingTerminalSelector('global-floating-terminal')).toBe(true)
    expect(isFloatingTerminalSelector('id:global-floating-terminal')).toBe(true)
  })

  it.each([
    undefined,
    '',
    'id:worktree-1',
    'worktree-1',
    'id:global-floating-terminal-2',
    'global-floating-terminal/x'
  ])('rejects every other selector (%j)', (selector) => {
    expect(isFloatingTerminalSelector(selector)).toBe(false)
  })
})
