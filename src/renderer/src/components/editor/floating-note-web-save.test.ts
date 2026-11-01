// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type * as RuntimeFileMutationRpc from '@/runtime/runtime-file-mutation-rpc'
import { setWebFloatingRuntimeOwnerResolver } from '@/lib/terminal-worktree-route'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import { requestEditorFileSave } from './editor-autosave'

const NOTES = '/home/coder/.config/orca/floating-workspace'
const calls = vi.hoisted(() => ({
  mutations: [] as { target: unknown; method: string; params: unknown }[]
}))

// Only the wire is replaced: everything from the editor save queue down to the RPC call is real.
vi.mock('@/runtime/runtime-file-mutation-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeFileMutationRpc>()),
  // Why: an editor save is a guarded write upstream; a current host advertises the capability.
  callRuntimeFileMutationWithCapabilities: vi.fn(
    async (
      target: unknown,
      method: string,
      plan: (capabilities: readonly string[]) => Promise<{ method?: string; params?: unknown }>
    ) => {
      const planned = await plan([
        'files.write.disk-precondition.v1',
        'files.write.identical-noop.v1'
      ])
      calls.mutations.push({ target, method: planned.method ?? method, params: planned.params })
      return { ok: true }
    }
  ),
  callRuntimeFileMutation: vi.fn(async (target: unknown, method: string, params: unknown) => {
    calls.mutations.push({ target, method, params })
  })
}))

function openWebFloatingNote(): string {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
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
  // The same shape the floating New Markdown Note action opens on web.
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

describe('saving a floating workspace note on web (#325)', () => {
  let detach: (() => void) | null = null

  beforeEach(() => {
    calls.mutations.length = 0
    setWebFloatingRuntimeOwnerResolver(() => 'web-env')
  })

  afterEach(() => {
    detach?.()
    detach = null
    setWebFloatingRuntimeOwnerResolver(null)
  })

  it('writes the note on the paired runtime (was: "Failed to save file")', async () => {
    const id = openWebFloatingNote()
    detach = attachEditorAutosaveController(useAppStore)
    // Why: upstream saves write only against the disk version the tab last loaded.
    useAppStore.getState().setLastKnownDiskSignature(id, 'disk-v1')
    useAppStore.getState().setEditorDraft(id, 'saved from the popout')
    useAppStore.getState().markFileDirty(id, true)

    await requestEditorFileSave({ fileId: id })

    expect(calls.mutations).toEqual([
      {
        target: expect.objectContaining({ kind: 'environment' }),
        method: 'files.writeIfUnchanged',
        params: expect.objectContaining({
          // The host's notes folder, addressed by its own `path:` selector (floating-notes-file-root).
          worktree: `path:${NOTES}`,
          relativePath: 'untitled.md',
          content: 'saved from the popout'
        })
      }
    ])
  })
})
