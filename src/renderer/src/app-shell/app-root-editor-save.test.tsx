// @vitest-environment happy-dom

import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type * as RuntimeFileMutationRpc from '@/runtime/runtime-file-mutation-rpc'
import { setWebFloatingRuntimeOwnerResolver } from '@/lib/terminal-worktree-route'
import { requestEditorFileSave } from '@/components/editor/editor-autosave'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { AppBackgroundServices } from './AppBackgroundServices'

const NOTES = '/home/coder/.config/orca/floating-workspace'
const calls = vi.hoisted(() => ({ writes: [] as { method: string; params: unknown }[] }))

// Only the wire is replaced: the background services, save controller, save queue and file client are real.
vi.mock('@/runtime/runtime-file-mutation-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeFileMutationRpc>()),
  // Why: an editor save is a guarded write upstream; a current host advertises the capability.
  callRuntimeFileMutationWithCapabilities: vi.fn(
    async (
      _target: unknown,
      method: string,
      plan: (capabilities: readonly string[]) => Promise<{ method?: string; params?: unknown }>
    ) => {
      const planned = await plan([
        'files.write.disk-precondition.v1',
        'files.write.identical-noop.v1'
      ])
      calls.writes.push({ method: planned.method ?? method, params: planned.params })
      return { ok: true }
    }
  ),
  callRuntimeFileMutation: vi.fn(async (_target: unknown, method: string, params: unknown) => {
    calls.writes.push({ method, params })
  })
}))

function seedNoProjectOpen(): string {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
    // A fresh Orca Web workspace: no project, so the terminal workbench never mounts.
    activeWorktreeId: null,
    settings: { editorAutoSave: false, activeRuntimeEnvironmentId: null },
    repos: [],
    worktreesByRepo: {},
    detectedWorktreesByRepo: {},
    runtimeEnvironments: [],
    runtimeEnvironmentCatalogHydrated: false,
    removedRuntimeEnvironmentIds: new Set(),
    sshConnectionStates: new Map(),
    sshStateByEnvironment: new Map()
  } as unknown as Partial<AppState>)
  return useAppStore.getState().openFile(
    {
      filePath: `${NOTES}/untitled.md`,
      relativePath: 'untitled.md',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      runtimeEnvironmentId: 'web-env',
      language: 'markdown',
      isUntitled: true,
      mode: 'edit'
    },
    { preview: false, suppressActiveRuntimeFallback: false }
  )
}

describe('editor save with no project open (#325)', () => {
  beforeEach(() => {
    calls.writes.length = 0
    setWebFloatingRuntimeOwnerResolver(() => 'web-env')
    // The background services' own subscriptions; none of them takes part in the save.
    vi.stubGlobal('api', { fs: { onFsChanged: () => () => {} }, gh: {} })
  })

  afterEach(() => {
    cleanup()
    setWebFloatingRuntimeOwnerResolver(null)
    vi.unstubAllGlobals()
  })

  it('the always-mounted root handles a floating note save (was: no save controller)', async () => {
    const id = seedNoProjectOpen()
    // App renders AppBackgroundServices unconditionally, beside the workspace shell.
    render(<AppBackgroundServices />)
    // Why: upstream saves write only against the disk version the tab last loaded.
    useAppStore.getState().setLastKnownDiskSignature(id, 'disk-v1')
    useAppStore.getState().setEditorDraft(id, 'saved from the popout')
    useAppStore.getState().markFileDirty(id, true)

    await requestEditorFileSave({ fileId: id })

    expect(calls.writes).toEqual([
      {
        method: 'files.writeIfUnchanged',
        params: expect.objectContaining({
          relativePath: 'untitled.md',
          content: 'saved from the popout'
        })
      }
    ])
  })
})
