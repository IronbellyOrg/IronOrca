import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { sanitizeWebRuntimeWorkspaceSession } from './web-workspace-session'

const FLOATING = FLOATING_TERMINAL_WORKTREE_ID

function terminal(id: string, worktreeId: string) {
  return {
    id,
    ptyId: `remote:web-old@@${id}`,
    worktreeId,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function sessionWithFloatingAndRepoTabs(): WorkspaceSessionState {
  return {
    activeRepoId: 'repo-1',
    activeWorktreeId: 'repo-1::/worktree',
    activeTabId: null,
    tabsByWorktree: {
      [FLOATING]: [terminal('floating-term', FLOATING)],
      'repo-1::/worktree': [terminal('repo-term', 'repo-1::/worktree')]
    },
    terminalLayoutsByTabId: {
      'floating-term': {
        root: { type: 'leaf', leafId: 'leaf-f' },
        activeLeafId: 'leaf-f',
        expandedLeafId: null,
        ptyIdsByLeafId: { 'leaf-f': 'remote:web-old@@floating-term' },
        buffersByLeafId: { 'leaf-f': 'old output' },
        titlesByLeafId: { 'leaf-f': 'shell' }
      },
      'repo-term': {
        root: { type: 'leaf', leafId: 'leaf-r' },
        activeLeafId: 'leaf-r',
        expandedLeafId: null
      }
    },
    openFilesByWorktree: {
      [FLOATING]: [
        {
          filePath: '/srv/floating-workspace/note.md',
          relativePath: 'note.md',
          worktreeId: FLOATING,
          language: 'markdown',
          runtimeEnvironmentId: 'web-env'
        }
      ],
      'repo-1::/worktree': [
        {
          filePath: '/worktree/README.md',
          relativePath: 'README.md',
          worktreeId: 'repo-1::/worktree',
          language: 'markdown'
        }
      ]
    },
    activeFileIdByWorktree: {
      [FLOATING]: '/srv/floating-workspace/note.md',
      'repo-1::/worktree': '/worktree/README.md'
    },
    activeTabTypeByWorktree: { [FLOATING]: 'terminal', 'repo-1::/worktree': 'editor' },
    activeTabIdByWorktree: { [FLOATING]: 'floating-term', 'repo-1::/worktree': 'repo-term' }
  }
}

describe('sanitizeWebRuntimeWorkspaceSession: floating workspace (#325)', () => {
  it('keeps the floating workspace tabs and files, still strips every other worktree', () => {
    const out = sanitizeWebRuntimeWorkspaceSession(sessionWithFloatingAndRepoTabs())

    expect(Object.keys(out.tabsByWorktree)).toEqual([FLOATING])
    expect(out.tabsByWorktree[FLOATING].map((tab) => tab.id)).toEqual(['floating-term'])
    expect(Object.keys(out.terminalLayoutsByTabId)).toEqual(['floating-term'])
    expect(Object.keys(out.openFilesByWorktree ?? {})).toEqual([FLOATING])
    expect(out.activeFileIdByWorktree).toEqual({ [FLOATING]: '/srv/floating-workspace/note.md' })
    expect(out.activeTabTypeByWorktree).toEqual({ [FLOATING]: 'terminal' })
    expect(out.activeTabIdByWorktree).toEqual({ [FLOATING]: 'floating-term' })
  })

  it('drops terminal handles so a restored floating tab starts a fresh shell', () => {
    const out = sanitizeWebRuntimeWorkspaceSession(sessionWithFloatingAndRepoTabs())
    const layout = out.terminalLayoutsByTabId['floating-term']

    expect(out.tabsByWorktree[FLOATING][0].ptyId).toBeNull()
    expect(layout.ptyIdsByLeafId).toBeUndefined()
    expect(layout.buffersByLeafId).toBeUndefined()
    expect(layout.titlesByLeafId).toEqual({ 'leaf-f': 'shell' })
    expect(JSON.stringify(out)).not.toContain('remote:web-old')
  })

  it('round-trips: a sanitized session sanitizes to itself', () => {
    const once = sanitizeWebRuntimeWorkspaceSession(sessionWithFloatingAndRepoTabs())
    expect(sanitizeWebRuntimeWorkspaceSession(once)).toEqual(once)
  })

  it('keeps a floating workspace that has only browser tabs', () => {
    const session = sessionWithFloatingAndRepoTabs()
    delete session.tabsByWorktree[FLOATING]
    delete session.openFilesByWorktree?.[FLOATING]
    session.browserTabsByWorktree = {
      [FLOATING]: [{ id: 'bw-1', activePageId: 'page-1' } as never]
    }
    session.browserPagesByWorkspace = {
      'bw-1': [{ id: 'page-1', url: 'https://example.com' } as never]
    }
    const out = sanitizeWebRuntimeWorkspaceSession(session)
    expect(out.browserTabsByWorktree?.[FLOATING]?.map((tab) => tab.id)).toEqual(['bw-1'])
    expect(Object.keys(out.browserPagesByWorkspace ?? {})).toEqual(['bw-1'])
    expect(out.activeTabTypeByWorktree).toEqual({ [FLOATING]: 'terminal' })
  })

  it('adds nothing when there is no floating workspace state', () => {
    const session = sessionWithFloatingAndRepoTabs()
    delete session.tabsByWorktree[FLOATING]
    delete session.openFilesByWorktree?.[FLOATING]
    const out = sanitizeWebRuntimeWorkspaceSession(session)
    expect(out).toEqual(
      sanitizeWebRuntimeWorkspaceSession({
        ...session,
        tabsByWorktree: {},
        openFilesByWorktree: {}
      })
    )
    expect(out.tabsByWorktree).toEqual({})
    expect(Object.keys(out.openFilesByWorktree ?? {})).toEqual([])
  })
})
