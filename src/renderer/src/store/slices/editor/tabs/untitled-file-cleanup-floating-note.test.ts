import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../../shared/constants'

// aidev02: closing an untouched floating note must delete the note in the host's notes folder,
// never a same-named file in the floating terminal directory.

const mocks = vi.hoisted(() => ({
  deleteRuntimePath: vi.fn(),
  deleteRuntimeRelativePath: vi.fn(),
  statRuntimePath: vi.fn()
}))

vi.mock('@/runtime/runtime-file-mutation-client', () => ({
  deleteRuntimePath: mocks.deleteRuntimePath,
  deleteRuntimeRelativePath: mocks.deleteRuntimeRelativePath
}))
vi.mock('@/runtime/runtime-file-metadata-client', () => ({
  statRuntimePath: mocks.statRuntimePath
}))
vi.mock('@/lib/editor-file-operation-owner', () => ({
  getEditorFileOperationContext: () => ({
    target: { kind: 'environment', environmentId: 'web-env' },
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    worktreePath: '/home/coder/workspaces'
  })
}))

import { deleteUntouchedUntitledFile } from './untitled-file-cleanup'

const NOTES = '/home/coder/.config/orca/floating-workspace'

function closeUntitled(filePath: string, relativePath: string): void {
  const file = {
    id: filePath,
    filePath,
    relativePath,
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    runtimeEnvironmentId: 'web-env',
    isUntitled: true
  }
  const state = { openFiles: [], worktreesByRepo: {} }
  deleteUntouchedUntitledFile(() => state as never, file as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.statRuntimePath.mockResolvedValue({ size: 0 })
  mocks.deleteRuntimePath.mockResolvedValue(undefined)
  mocks.deleteRuntimeRelativePath.mockResolvedValue(true)
})

describe('closing an untouched floating note', () => {
  it('deletes the note by its own path, not by a bare name in the terminal directory', async () => {
    closeUntitled(`${NOTES}/untitled.md`, 'untitled.md')
    await vi.waitFor(() =>
      expect(mocks.deleteRuntimePath).toHaveBeenCalledWith(
        expect.anything(),
        `${NOTES}/untitled.md`
      )
    )
    expect(mocks.deleteRuntimeRelativePath).not.toHaveBeenCalled()
  })

  it('keeps the relative delete for a floating file outside the notes folder', async () => {
    closeUntitled('/home/coder/workspaces/untitled.md', 'untitled.md')
    await vi.waitFor(() =>
      expect(mocks.deleteRuntimeRelativePath).toHaveBeenCalledWith(expect.anything(), 'untitled.md')
    )
    expect(mocks.deleteRuntimePath).not.toHaveBeenCalled()
  })

  it('deletes nothing when the note has content', async () => {
    mocks.statRuntimePath.mockResolvedValue({ size: 12 })
    closeUntitled(`${NOTES}/untitled.md`, 'untitled.md')
    await vi.waitFor(() => expect(mocks.statRuntimePath).toHaveBeenCalled())
    await Promise.resolve()
    expect(mocks.deleteRuntimePath).not.toHaveBeenCalled()
    expect(mocks.deleteRuntimeRelativePath).not.toHaveBeenCalled()
  })
})
