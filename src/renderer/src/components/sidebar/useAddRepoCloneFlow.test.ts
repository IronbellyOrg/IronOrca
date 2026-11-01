import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactModule from 'react'
import type { Repo } from '../../../../shared/repo-types'

const mocks = vi.hoisted(() => ({
  stateValues: [] as unknown[],
  stateSetters: [] as ReturnType<typeof vi.fn>[],
  stateIndex: 0,
  refValues: [] as unknown[],
  refIndex: 0,
  storeState: {
    settings: { activeRuntimeEnvironmentId: null as string | null },
    repos: [] as Repo[],
    projects: [],
    projectHostSetups: []
  },
  cloneLocal: vi.fn(),
  pickDirectory: vi.fn(),
  onCloneProgress: vi.fn(() => vi.fn()),
  callRuntimeRpc: vi.fn(),
  fetchWorktrees: vi.fn(),
  onGitRepoReady: vi.fn(),
  browseRuntimeServerDirectory: vi.fn()
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useEffect: (effect: () => void | (() => void)) => {
      effect()
    },
    useRef: <T>(value: T) => {
      const index = mocks.refIndex++
      return {
        current: index in mocks.refValues ? (mocks.refValues[index] as T) : value
      }
    },
    useState: <T>(initial: T | (() => T)) => {
      const index = mocks.stateIndex++
      const value =
        index in mocks.stateValues
          ? mocks.stateValues[index]
          : typeof initial === 'function'
            ? (initial as () => T)()
            : initial
      const setter = vi.fn()
      mocks.stateSetters[index] = setter
      return [value as T, setter]
    }
  }
})

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof mocks.storeState) => unknown) => selector(mocks.storeState),
    {
      getState: () => mocks.storeState,
      setState: (next: Partial<typeof mocks.storeState>) => {
        Object.assign(mocks.storeState, next)
      }
    }
  )
  return { useAppStore }
})

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))

vi.mock('@/runtime/runtime-server-directory-browser', () => ({
  browseRuntimeServerDirectory: mocks.browseRuntimeServerDirectory
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type DestinationUpdater = (prev: string) => string

// Why: the hook writes the destination through a functional updater; the mocked
// setter only records it, so tests apply the recorded updater themselves.
function destinationUpdaters(): DestinationUpdater[] {
  return mocks.stateSetters[1].mock.calls
    .map(([value]) => value as unknown)
    .filter((value): value is DestinationUpdater => typeof value === 'function')
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-cloned',
    path: '/srv/orca',
    displayName: 'orca',
    badgeColor: '#999999',
    addedAt: 1,
    kind: 'git',
    ...overrides
  }
}

describe('useAddRepoCloneFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stateIndex = 0
    mocks.stateSetters = []
    mocks.refIndex = 0
    mocks.refValues = []
    mocks.stateValues = ['https://github.com/stablyai/orca.git', '/srv', false, null, null]
    mocks.storeState.repos = []
    mocks.storeState.projects = []
    mocks.storeState.projectHostSetups = []
    vi.stubGlobal('window', {
      api: {
        repos: {
          clone: mocks.cloneLocal,
          pickDirectory: mocks.pickDirectory,
          onCloneProgress: mocks.onCloneProgress
        }
      }
    })
  })

  it('strips Electron IPC wrappers from clone errors', async () => {
    const cloneError =
      'Clone failed: Destination already exists and is not empty: /srv/orca. Choose a different parent folder, delete the existing folder, or add the existing repository instead.'
    mocks.cloneLocal.mockRejectedValue(
      new Error(`Error invoking remote method 'repos:clone': Error: ${cloneError}`)
    )
    const { useAddRepoCloneFlow } = await import('./useAddRepoCloneFlow')

    const result = useAddRepoCloneFlow({
      step: 'clone',
      activeRuntimeEnvironmentId: null,
      workspaceDir: '/local/workspace',
      fetchWorktrees: mocks.fetchWorktrees,
      onGitRepoReady: mocks.onGitRepoReady
    })
    await result.handleClone()

    expect(mocks.stateSetters[3]).toHaveBeenCalledWith(cloneError)
  })

  it('clones through the selected runtime environment', async () => {
    const repo = makeRepo({ id: 'runtime-repo' })
    const localRepo = makeRepo({
      id: repo.id,
      path: '/local/runtime-repo',
      executionHostId: 'local'
    })
    mocks.storeState.repos = [localRepo]
    mocks.callRuntimeRpc.mockResolvedValue({ repo })
    mocks.fetchWorktrees.mockResolvedValue(true)
    const { useAddRepoCloneFlow } = await import('./useAddRepoCloneFlow')

    const result = useAddRepoCloneFlow({
      step: 'clone',
      activeRuntimeEnvironmentId: 'env-1',
      workspaceDir: '/local/workspace',
      fetchWorktrees: mocks.fetchWorktrees,
      onGitRepoReady: mocks.onGitRepoReady
    })
    await result.handleClone()

    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'repo.clone',
      {
        url: 'https://github.com/stablyai/orca.git',
        destination: '/srv'
      },
      { timeoutMs: 10 * 60_000 }
    )
    expect(mocks.cloneLocal).not.toHaveBeenCalled()
    expect(mocks.fetchWorktrees).toHaveBeenCalledWith(repo.id, {
      requireAuthoritative: true,
      executionHostId: 'runtime:env-1'
    })
    expect(mocks.storeState.repos).toContainEqual({
      ...repo,
      executionHostId: 'runtime:env-1'
    })
    expect(mocks.storeState.repos).toContainEqual(localRepo)
    expect(mocks.onGitRepoReady).toHaveBeenCalledWith(repo.id, 'clone_url', 'runtime:env-1')
  })

  it('never clones onto this computer while the chosen host is unresolved', async () => {
    const { useAddRepoCloneFlow } = await import('./useAddRepoCloneFlow')

    const result = useAddRepoCloneFlow({
      step: 'clone',
      hostId: null,
      activeRuntimeEnvironmentId: null,
      workspaceDir: '/local/workspace',
      fetchWorktrees: mocks.fetchWorktrees,
      onGitRepoReady: mocks.onGitRepoReady
    })
    await result.handleClone()

    expect(mocks.cloneLocal).not.toHaveBeenCalled()
  })

  it('prefills an empty runtime clone destination with the host workspaces directory', async () => {
    mocks.stateValues = ['https://github.com/stablyai/orca.git', '', false, null, null]
    mocks.browseRuntimeServerDirectory.mockResolvedValue({ resolvedPath: '/home/coder' })
    const { useAddRepoCloneFlow } = await import('./useAddRepoCloneFlow')

    useAddRepoCloneFlow({
      step: 'clone',
      activeRuntimeEnvironmentId: 'env-1',
      workspaceDir: '/local/workspace',
      fetchWorktrees: mocks.fetchWorktrees,
      onGitRepoReady: mocks.onGitRepoReady
    })
    await flushAsync()

    expect(mocks.browseRuntimeServerDirectory).toHaveBeenCalledWith('env-1', '~')
    const updaters = destinationUpdaters()
    expect(updaters).toHaveLength(1)
    expect(updaters[0]('')).toBe('/home/coder/workspaces')
  })

  it('keeps a destination typed while the runtime default was resolving', async () => {
    mocks.stateValues = ['https://github.com/stablyai/orca.git', '', false, null, null]
    const pending = deferred<{ resolvedPath: string }>()
    mocks.browseRuntimeServerDirectory.mockReturnValue(pending.promise)
    const { useAddRepoCloneFlow } = await import('./useAddRepoCloneFlow')

    useAddRepoCloneFlow({
      step: 'clone',
      activeRuntimeEnvironmentId: 'env-1',
      workspaceDir: '/local/workspace',
      fetchWorktrees: mocks.fetchWorktrees,
      onGitRepoReady: mocks.onGitRepoReady
    })
    pending.resolve({ resolvedPath: '/home/coder' })
    await pending.promise
    await flushAsync()

    const updaters = destinationUpdaters()
    expect(updaters).toHaveLength(1)
    expect(updaters[0]('/srv/typed')).toBe('/srv/typed')
  })

  it('drops a runtime default that resolves after a host-switch reset', async () => {
    mocks.stateValues = ['https://github.com/stablyai/orca.git', '', false, null, null]
    const pending = deferred<{ resolvedPath: string }>()
    mocks.browseRuntimeServerDirectory.mockReturnValue(pending.promise)
    const { useAddRepoCloneFlow } = await import('./useAddRepoCloneFlow')

    const result = useAddRepoCloneFlow({
      step: 'clone',
      activeRuntimeEnvironmentId: 'env-1',
      workspaceDir: '/local/workspace',
      fetchWorktrees: mocks.fetchWorktrees,
      onGitRepoReady: mocks.onGitRepoReady
    })
    // Why: a host switch reaches resetCloneFlow through the dialog's host-scoped reset.
    result.resetCloneFlow()
    pending.resolve({ resolvedPath: '/home/coder' })
    await pending.promise
    await flushAsync()

    expect(mocks.stateSetters[1]).toHaveBeenCalledWith('')
    expect(destinationUpdaters()).toHaveLength(0)
  })

  it('leaves the runtime clone destination empty when the host home cannot be read', async () => {
    mocks.stateValues = ['https://github.com/stablyai/orca.git', '', false, null, null]
    mocks.browseRuntimeServerDirectory.mockRejectedValue(new Error('runtime offline'))
    const { useAddRepoCloneFlow } = await import('./useAddRepoCloneFlow')

    const result = useAddRepoCloneFlow({
      step: 'clone',
      activeRuntimeEnvironmentId: 'env-1',
      workspaceDir: '/local/workspace',
      fetchWorktrees: mocks.fetchWorktrees,
      onGitRepoReady: mocks.onGitRepoReady
    })
    await flushAsync()

    expect(mocks.browseRuntimeServerDirectory).toHaveBeenCalledWith('env-1', '~')
    expect(result.cloneDestination).toBe('')
    expect(mocks.stateSetters[1]).not.toHaveBeenCalled()
  })
})
