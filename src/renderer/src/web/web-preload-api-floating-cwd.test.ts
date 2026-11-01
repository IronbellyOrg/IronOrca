import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

const SERVER_HOME = '/srv/the-runtime-server-home'
const BROWSER_HOME = '/home/the-browser-machine'

const hoisted = vi.hoisted(() => ({
  toastError: vi.fn(),
  browseCalls: [] as { environmentId: string; path: string }[],
  serverDirectories: new Set<string>(),
  mode: 'up' as 'up' | 'down'
}))

vi.mock('sonner', () => ({ toast: { error: hoisted.toastError } }))

// A fake runtime server that follows the files.browseServerDir contract, which the real
// RuntimeServerEnvironmentCommands.browseDirectory is tested against in the main-process suite
// (runtime-floating-launch-cwd.test.ts): `~` expands against the SERVER home, a missing directory
// rejects, and `resolvedPath` is absolute. Only the RPC wrapper is replaced.
vi.mock('../runtime/runtime-server-directory-browser', () => ({
  browseRuntimeServerDirectory: vi.fn(async (environmentId: string, path: string) => {
    hoisted.browseCalls.push({ environmentId, path })
    if (hoisted.mode === 'down') {
      throw new Error('runtime unreachable')
    }
    const resolvedPath =
      path === '~' ? SERVER_HOME : path.startsWith('~/') ? `${SERVER_HOME}/${path.slice(2)}` : path
    if (resolvedPath !== SERVER_HOME && !hoisted.serverDirectories.has(resolvedPath)) {
      throw new Error(`ENOENT: no such file or directory, stat '${resolvedPath}'`)
    }
    return { resolvedPath, entries: [], pathFlavor: 'posix' as const }
  })
}))

async function installWithEnvironment(pair: boolean) {
  const globals = installBrowserGlobals('Linux')
  if (pair) {
    writeStoredRuntimeEnvironment(globals.storage)
  }
  const { installWebPreloadApi } = await import('./web-preload-api')
  installWebPreloadApi()
  return globals
}

describe('web getFloatingTerminalCwd', () => {
  beforeEach(() => {
    vi.resetModules()
    hoisted.toastError.mockClear()
    hoisted.browseCalls.length = 0
    hoisted.serverDirectories.clear()
    hoisted.mode = 'up'
    vi.stubEnv('HOME', BROWSER_HOME)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('resolves ~/workspaces on the runtime server, not on the browser machine', async () => {
    hoisted.serverDirectories.add(`${SERVER_HOME}/workspaces`)
    const globals = await installWithEnvironment(true)

    const resolved = await globals.window.api.app.getFloatingTerminalCwd({ path: '~/workspaces' })

    expect(resolved).toBe(`${SERVER_HOME}/workspaces`)
    expect(resolved).not.toContain(BROWSER_HOME)
    expect(hoisted.browseCalls).toEqual([{ environmentId: 'web-env-1', path: '~/workspaces' }])
    expect(hoisted.toastError).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '   ', '~'])('maps %j to the server home', async (path) => {
    const globals = await installWithEnvironment(true)
    const resolved = await globals.window.api.app.getFloatingTerminalCwd(
      path === undefined ? undefined : { path }
    )
    expect(resolved).toBe(SERVER_HOME)
    expect(hoisted.toastError).not.toHaveBeenCalled()
  })

  it('falls back to the server home and says so once when the directory is missing', async () => {
    const globals = await installWithEnvironment(true)

    const first = await globals.window.api.app.getFloatingTerminalCwd({ path: '~/workspaces' })
    const second = await globals.window.api.app.getFloatingTerminalCwd({ path: '~/workspaces' })

    expect(first).toBe(SERVER_HOME)
    expect(second).toBe(SERVER_HOME)
    expect(hoisted.toastError).toHaveBeenCalledTimes(1)
    expect(String(hoisted.toastError.mock.calls[0]?.[0])).toContain('~/workspaces')
    // A stable id is what keeps re-mounts of the panel / Settings from stacking the same toast.
    expect(hoisted.toastError.mock.calls[0]?.[1]).toEqual({
      id: 'web-floating-workspace-directory-missing'
    })
  })

  it('returns the configured string, never an empty one, when the server cannot be reached', async () => {
    hoisted.mode = 'down'
    const globals = await installWithEnvironment(true)

    const first = await globals.window.api.app.getFloatingTerminalCwd({ path: '~/workspaces' })
    const second = await globals.window.api.app.getFloatingTerminalCwd({ path: '~/workspaces' })

    // The host expands and validates it when the terminal is created, and falls back to its home.
    expect(first).toBe('~/workspaces')
    expect(second).toBe('~/workspaces')
    expect(hoisted.toastError).toHaveBeenCalledTimes(1)
    expect(hoisted.toastError.mock.calls[0]?.[1]).toEqual({
      id: 'web-floating-workspace-server-unreachable'
    })
  })

  it('does not reject when the server cannot be reached and the path is already ~', async () => {
    hoisted.mode = 'down'
    const globals = await installWithEnvironment(true)
    await expect(globals.window.api.app.getFloatingTerminalCwd({ path: '~' })).resolves.toBe('~')
  })

  it('returns an empty string silently, without any RPC, when no environment is paired yet', async () => {
    const globals = await installWithEnvironment(false)

    const resolved = await globals.window.api.app.getFloatingTerminalCwd({ path: '~/workspaces' })
    const onboarding = await globals.window.api.app.getFloatingTerminalCwd({ path: '~' })

    expect(resolved).toBe('')
    expect(onboarding).toBe('')
    expect(hoisted.browseCalls).toEqual([])
    expect(hoisted.toastError).not.toHaveBeenCalled()
  })

  it('serves the onboarding terminal (path ~) on the active environment without a floating toast', async () => {
    const globals = await installWithEnvironment(true)
    expect(await globals.window.api.app.getFloatingTerminalCwd({ path: '~' })).toBe(SERVER_HOME)
    expect(hoisted.toastError).not.toHaveBeenCalled()
  })
})
