import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { serveOrcaApp } from './runtime/launch'
import { getServeOptions } from '../main/startup/serve-options'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

describe('orca cli worktree awareness', () => {
  const priorExitCode = process.exitCode
  beforeEach(() => {
    process.exitCode = undefined
  })
  afterEach(() => {
    process.exitCode = priorExitCode
  })
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it.each(['127.0.0.1', '::1'])(
    'passes literal bind %s through the real serve handler',
    async (bindHost) => {
      serveOrcaAppMock.mockResolvedValue(0)
      for (const args of [['--bind', bindHost], [`--bind=${bindHost}`]]) {
        serveOrcaAppMock.mockClear()
        await main(['serve', ...args, '--json'], '/tmp/repo')
        expect(serveOrcaAppMock).toHaveBeenCalledWith(expect.objectContaining({ bindHost }))
      }
    }
  )

  it.each([
    ['--bind'],
    ['--bind='],
    ['--bind', ''],
    ['--bind', '--json'],
    ['--bind=localhost'],
    ['--bind=https://127.0.0.1'],
    ['--bind=127.0.0.1:6768'],
    ['--bind=[::1]'],
    ['--bind=false'],
    ['--bind= '],
    ['--bnd=127.0.0.1']
  ])('rejects unusable bind argv %j before spawning', async (...args) => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode
    try {
      await main(['serve', ...args], '/tmp/repo')
      expect(serveOrcaAppMock).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = priorExitCode
    }
  })

  it.each([undefined, '127.0.0.1', '::1'])(
    'carries bind %s from main through CORE_HANDLERS and the real launcher into Electron argv',
    async (bindHost) => {
      vi.stubEnv('ORCA_APP_EXECUTABLE', '/opt/orca/orca-ide')
      vi.stubEnv('ORCA_APP_EXECUTABLE_NEEDS_APP_ROOT', '')
      // Why: the Coder template serves on the Electron runtime (runtime.mjs sets this), the one
      // host the loopback-bind and browser mobile-pairing changes are wired into.
      vi.stubEnv('ORCA_SERVE_RUNTIME', 'electron')
      serveOrcaAppMock.mockImplementation(serveOrcaApp)
      const priorExitCode = process.exitCode
      try {
        await main(['serve', ...(bindHost ? [`--bind=${bindHost}`] : []), '--json'], '/tmp/repo')
        expect(spawnMock).toHaveBeenCalledTimes(1)
        const childArgs = spawnMock.mock.calls[0][1] as string[]
        expect(getServeOptions(['/opt/orca/orca-ide', ...childArgs]).bindHost).toBe(bindHost)
        if (bindHost) {
          const index = childArgs.indexOf('--serve-bind')
          expect(index).toBeGreaterThanOrEqual(0)
          expect(childArgs[index + 1]).toBe(bindHost)
        } else {
          expect(childArgs).not.toContain('--serve-bind')
        }
        expect(process.exitCode).toBe(0)
      } finally {
        vi.unstubAllEnvs()
        process.exitCode = priorExitCode
      }
    }
  )

  it('starts a foreground headless server through `serve`', async () => {
    serveOrcaAppMock.mockResolvedValue(17)
    process.env.ORCA_ENVIRONMENT = 'stale-env'

    await main(
      ['serve', '--json', '--port', '6768', '--pairing-address', '100.64.1.20', '--no-pairing'],
      '/tmp/repo'
    )

    expect(serveOrcaAppMock).toHaveBeenCalledExactlyOnceWith({
      json: true,
      port: '6768',
      pairingAddress: '100.64.1.20',
      noPairing: true,
      mobilePairing: false,
      grantDesktopControl: false,
      recipeJson: false,
      projectRoot: null
    })
    expect(process.exitCode).toBe(17)
    expect(callMock).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'turns on supervision only for an explicit --supervise, and never with --recipe-json',
    async () => {
      serveOrcaAppMock.mockResolvedValue(0)

      await main(['serve', '--supervise', '--no-pairing'], '/tmp/repo')
      expect(serveOrcaAppMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ supervise: true, noPairing: true })
      )

      await main(['serve', '--no-pairing'], '/tmp/repo')
      expect(serveOrcaAppMock.mock.lastCall?.[0]).not.toHaveProperty('supervise')

      serveOrcaAppMock.mockClear()
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      await main(
        ['serve', '--supervise', '--recipe-json', '--project-root', '/workspace/repo'],
        '/tmp/repo'
      )
      expect(serveOrcaAppMock).not.toHaveBeenCalled()
      expect(error).toHaveBeenCalledExactlyOnceWith(
        '--recipe-json starts a detached server and returns; it cannot be combined with --supervise.'
      )
      expect(process.exitCode).toBe(1)
    }
  )

  it('forwards the pairing-time desktop-control grant', async () => {
    serveOrcaAppMock.mockResolvedValue(0)

    await main(['serve', '--grant-desktop-control'], '/tmp/repo')

    expect(serveOrcaAppMock).toHaveBeenCalledWith(
      expect.objectContaining({ grantDesktopControl: true, mobilePairing: false })
    )
  })

  it('starts a foreground headless server with mobile pairing enabled', async () => {
    serveOrcaAppMock.mockResolvedValue(0)

    await main(
      ['serve', '--pairing-address', '100.64.1.20', '--mobile-pairing', '--json'],
      '/tmp/repo'
    )

    expect(serveOrcaAppMock).toHaveBeenCalledExactlyOnceWith({
      json: true,
      port: null,
      pairingAddress: '100.64.1.20',
      noPairing: false,
      mobilePairing: true,
      grantDesktopControl: false,
      recipeJson: false,
      projectRoot: null
    })
  })

  it('starts a recipe JSON headless server for VM recipes', async () => {
    serveOrcaAppMock.mockResolvedValue(0)

    await main(
      [
        'serve',
        '--pairing-address',
        'wss://sandbox.example.com',
        '--project-root',
        '/workspace/repo',
        '--recipe-json'
      ],
      '/tmp/repo'
    )

    expect(serveOrcaAppMock).toHaveBeenCalledExactlyOnceWith({
      json: false,
      port: null,
      pairingAddress: 'wss://sandbox.example.com',
      noPairing: false,
      mobilePairing: false,
      grantDesktopControl: false,
      recipeJson: true,
      projectRoot: '/workspace/repo'
    })
  })

  it.each([
    {
      name: 'recipe JSON output without a project root',
      args: ['serve', '--recipe-json'],
      message: 'Recipe JSON output requires --project-root.'
    },
    {
      name: 'recipe JSON output with mobile pairing',
      args: ['serve', '--recipe-json', '--project-root', '/workspace/repo', '--mobile-pairing'],
      message: 'Recipe JSON output requires runtime pairing; remove --mobile-pairing.'
    },
    {
      name: 'contradictory pairing flags',
      args: ['serve', '--mobile-pairing', '--no-pairing'],
      message: 'Use either --mobile-pairing or --no-pairing, not both.'
    },
    {
      name: 'an invalid port',
      args: ['serve', '--port', 'not-a-port'],
      message: 'Invalid --port value: not-a-port'
    },
    {
      name: 'a valueless port',
      args: ['serve', '--port'],
      message: 'Missing value for --port.'
    }
  ])('rejects $name before launching the app', async ({ args, message }) => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await main([...args, '--json'], '/tmp/repo')

    expect(serveOrcaAppMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(logSpy.mock.calls[0][0])).toEqual({
      id: 'local',
      ok: false,
      error: { code: 'invalid_argument', message },
      _meta: { runtimeId: null }
    })
    expect(process.exitCode).toBe(1)
  })
})
