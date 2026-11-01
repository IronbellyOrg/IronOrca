import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

const FLOATING = FLOATING_TERMINAL_WORKTREE_ID
const SESSION_KEY = 'orca.web.workspaceSession.v1'

function terminal(id: string, worktreeId: string) {
  return {
    id,
    ptyId: `remote:old@@${id}`,
    worktreeId,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

async function install(pair: boolean) {
  const globals = installBrowserGlobals('Linux')
  if (pair) {
    writeStoredRuntimeEnvironment(globals.storage)
  }
  const { installWebPreloadApi } = await import('./web-preload-api')
  installWebPreloadApi()
  return globals
}

describe('web session reload keeps floating tabs (#325)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a paired client reads its saved floating tabs back after a reload', async () => {
    await install(true)
    await window.api.session.set({
      activeRepoId: 'repo-1',
      activeWorktreeId: 'repo-1::/worktree',
      activeTabId: null,
      tabsByWorktree: {
        [FLOATING]: [terminal('floating-term', FLOATING)],
        'repo-1::/worktree': [terminal('repo-term', 'repo-1::/worktree')]
      },
      terminalLayoutsByTabId: {},
      openFilesByWorktree: {
        [FLOATING]: [
          {
            filePath: '/srv/floating-workspace/note.md',
            relativePath: 'note.md',
            worktreeId: FLOATING,
            language: 'markdown',
            runtimeEnvironmentId: 'web-env-1'
          }
        ]
      }
    } as never)

    const restored = await window.api.session.get()

    expect(Object.keys(restored.tabsByWorktree)).toEqual([FLOATING])
    expect(restored.tabsByWorktree[FLOATING].map((tab) => tab.id)).toEqual(['floating-term'])
    expect(restored.tabsByWorktree[FLOATING][0].ptyId).toBeNull()
    expect(restored.openFilesByWorktree?.[FLOATING]?.map((file) => file.relativePath)).toEqual([
      'note.md'
    ])
    expect(window.localStorage.getItem(SESSION_KEY)).not.toContain('remote:old')
  })

  it('an unpaired client reads the same floating tabs back', async () => {
    await install(false)
    await window.api.session.set({
      activeRepoId: null,
      activeWorktreeId: null,
      activeTabId: null,
      tabsByWorktree: { [FLOATING]: [terminal('floating-term', FLOATING)] },
      terminalLayoutsByTabId: {}
    } as never)
    const restored = await window.api.session.get()
    expect(restored.tabsByWorktree[FLOATING].map((tab) => tab.id)).toEqual(['floating-term'])
  })
})
