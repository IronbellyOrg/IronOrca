import { afterEach, describe, expect, it } from 'vitest'
import type { AppState } from '@/store/types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import {
  hasUnroutableTerminalWorktreeOwner,
  resolveTerminalHostOwnership,
  resolveTerminalPaneSpawnRoute,
  resolveTerminalWorktreeRoute,
  setWebFloatingRuntimeOwnerResolver
} from './terminal-worktree-route'

// Web-realistic store: pairing leaves the settings preference null, and the runtimeEnvironments
// slice may still be empty (it fills from an async list()). The owner must not depend on either.
function webState(overrides: Partial<AppState> = {}): AppState {
  return {
    repos: [],
    worktreesByRepo: {},
    runtimeEnvironments: [],
    runtimeEnvironmentCatalogHydrated: false,
    removedRuntimeEnvironmentIds: new Set<string>(),
    settings: { activeRuntimeEnvironmentId: null },
    ...overrides
  } as unknown as AppState
}

const LOCAL = { kind: 'local-or-ssh', runtimeEnvironmentId: null } as const

afterEach(() => {
  setWebFloatingRuntimeOwnerResolver(null)
})

describe('resolveTerminalPaneSpawnRoute (pty connect time)', () => {
  it('routes the floating terminal to the paired runtime when the web resolver returns one', () => {
    setWebFloatingRuntimeOwnerResolver(() => 'env-web')
    expect(resolveTerminalPaneSpawnRoute(webState(), FLOATING_TERMINAL_WORKTREE_ID)).toEqual({
      runtimeEnvironmentId: 'env-web'
    })
  })

  it.each([
    ['no resolver registered (Electron)', null],
    ['a resolver that finds no environment', () => null]
  ])('keeps the floating terminal local with %s', (_label, resolver) => {
    setWebFloatingRuntimeOwnerResolver(resolver)
    expect(resolveTerminalPaneSpawnRoute(webState(), FLOATING_TERMINAL_WORKTREE_ID)).toEqual({
      runtimeEnvironmentId: null
    })
  })

  it('is identical to the shared route for folder workspaces and unknown worktrees', () => {
    setWebFloatingRuntimeOwnerResolver(() => 'env-web')
    const folderKey = folderWorkspaceKey('folder-1')
    for (const id of [folderKey, 'repo-1::/w', null, undefined]) {
      expect(resolveTerminalPaneSpawnRoute(webState(), id)).toEqual(
        resolveTerminalWorktreeRoute(webState(), id)
      )
    }
  })
})

describe('shared terminal ownership is untouched by the web floating owner', () => {
  // Why this matters: closing/bulk-closing/creating a tab treat a runtime owner as a host-mirrored
  // session tab. Floating tabs are never host-mirrored, so if the shared route reported the
  // runtime, closing a floating tab would skip terminal.close and leak the remote shell.
  it('keeps the shared route, spawn ownership, teardown ownership and routability local', () => {
    setWebFloatingRuntimeOwnerResolver(() => 'env-web')
    const state = webState()
    expect(resolveTerminalWorktreeRoute(state, FLOATING_TERMINAL_WORKTREE_ID)).toEqual({
      runtimeEnvironmentId: null
    })
    expect(resolveTerminalHostOwnership(state, FLOATING_TERMINAL_WORKTREE_ID, 'spawn')).toEqual(
      LOCAL
    )
    expect(resolveTerminalHostOwnership(state, FLOATING_TERMINAL_WORKTREE_ID, 'teardown')).toEqual(
      LOCAL
    )
    expect(hasUnroutableTerminalWorktreeOwner(state, FLOATING_TERMINAL_WORKTREE_ID)).toBe(false)
  })
})
