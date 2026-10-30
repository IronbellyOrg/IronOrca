import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { setWebFloatingRuntimeOwnerResolver } from './terminal-worktree-route'

const NOTES = '/srv/user-data/floating-workspace'
const created = vi.hoisted(() => ({ calls: [] as unknown[][] }))

vi.mock('./create-untitled-markdown', () => ({
  createUntitledMarkdownFileWithTemplateSelection: vi.fn(async (...args: unknown[]) => {
    created.calls.push(args)
    return {
      filePath: `${String(args[0])}/untitled.md`,
      relativePath: 'untitled.md',
      worktreeId: args[1],
      language: 'markdown',
      isUntitled: true,
      mode: 'edit'
    }
  })
}))

import { createFloatingWorkspaceMarkdownTab } from './floating-workspace-tab-creation'

function store() {
  return { activeGroupIdByWorktree: {}, openFile: vi.fn() }
}

afterEach(() => {
  created.calls.length = 0
  setWebFloatingRuntimeOwnerResolver(null)
  vi.unstubAllGlobals()
})

describe('floating New Markdown on web (#325)', () => {
  it('asks again when the notes directory was not resolved earlier', async () => {
    const getFloatingMarkdownDirectory = vi.fn(async () => NOTES)
    vi.stubGlobal('window', { api: { app: { getFloatingMarkdownDirectory } } })
    setWebFloatingRuntimeOwnerResolver(() => 'web-env')
    const s = store()

    await createFloatingWorkspaceMarkdownTab(s as never, '')

    expect(getFloatingMarkdownDirectory).toHaveBeenCalledTimes(1)
    expect(created.calls[0]?.[0]).toBe(NOTES)
    expect(created.calls[0]?.[3]).toEqual({ kind: 'environment', environmentId: 'web-env' })
    expect(s.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        runtimeEnvironmentId: 'web-env'
      }),
      expect.objectContaining({ suppressActiveRuntimeFallback: false })
    )
  })

  it('stays local and suppresses the runtime fallback on Electron', async () => {
    vi.stubGlobal('window', { api: { app: { getFloatingMarkdownDirectory: vi.fn() } } })
    const s = store()

    await createFloatingWorkspaceMarkdownTab(s as never, '/home/me/notes')

    const [file, options] = s.openFile.mock.calls[0]!
    expect(file).not.toHaveProperty('runtimeEnvironmentId')
    expect(options).toMatchObject({ suppressActiveRuntimeFallback: true })
  })
})
