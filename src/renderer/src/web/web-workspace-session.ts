import {
  FLOATING_TERMINAL_WORKTREE_ID,
  getDefaultWorkspaceSession
} from '../../../shared/constants'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'

const FLOATING = FLOATING_TERMINAL_WORKTREE_ID

function floatingEntry<T>(record: Record<string, T> | undefined): Record<string, T> | undefined {
  return record && Object.hasOwn(record, FLOATING) ? { [FLOATING]: record[FLOATING] } : undefined
}

// Why: the host's session-tabs mirror deliberately skips the floating workspace, so on web the
// browser is the only place its tabs can survive a reload. Keep just that slice. Terminal handles
// are dropped (ptyId, pane PTY ids and buffers): a restored floating tab starts a fresh shell on
// the paired runtime instead of replaying a stale remote selector from an older pairing.
function floatingSlice(session: WorkspaceSessionState): Partial<WorkspaceSessionState> {
  const tabs = session.tabsByWorktree?.[FLOATING]
  const browserWorkspaces = session.browserTabsByWorktree?.[FLOATING] ?? []
  if (
    !tabs?.length &&
    !session.openFilesByWorktree?.[FLOATING]?.length &&
    !browserWorkspaces.length
  ) {
    return {}
  }
  const tabIds = new Set((tabs ?? []).map((tab) => tab.id))
  const terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot> = {}
  for (const [tabId, layout] of Object.entries(session.terminalLayoutsByTabId ?? {})) {
    if (!tabIds.has(tabId)) {
      continue
    }
    const {
      ptyIdsByLeafId: _pty,
      buffersByLeafId: _buf,
      scrollbackRefsByLeafId: _ref,
      ...rest
    } = layout
    terminalLayoutsByTabId[tabId] = rest
  }
  const browserPagesByWorkspace = Object.fromEntries(
    browserWorkspaces
      .map((workspace) => [workspace.id, session.browserPagesByWorkspace?.[workspace.id]] as const)
      .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]))
  )
  return {
    tabsByWorktree: tabs ? { [FLOATING]: tabs.map((tab) => ({ ...tab, ptyId: null })) } : {},
    terminalLayoutsByTabId,
    openFilesByWorktree: floatingEntry(session.openFilesByWorktree),
    activeFileIdByWorktree: floatingEntry(session.activeFileIdByWorktree),
    browserTabsByWorktree: floatingEntry(session.browserTabsByWorktree),
    browserPagesByWorkspace,
    activeBrowserTabIdByWorktree: floatingEntry(session.activeBrowserTabIdByWorktree),
    activeTabTypeByWorktree: floatingEntry(session.activeTabTypeByWorktree),
    activeTabIdByWorktree: floatingEntry(session.activeTabIdByWorktree),
    unifiedTabs: floatingEntry(session.unifiedTabs),
    tabGroups: floatingEntry(session.tabGroups),
    tabGroupLayouts: floatingEntry(session.tabGroupLayouts),
    activeGroupIdByWorktree: floatingEntry(session.activeGroupIdByWorktree)
  }
}

export function sanitizeWebRuntimeWorkspaceSession(
  session: WorkspaceSessionState
): WorkspaceSessionState {
  const defaults = getDefaultWorkspaceSession()
  return {
    ...defaults,
    // Host supplies live tabs; browser-persisted handles replay stale selectors after re-pair or host restart.
    activeRepoId: session.activeRepoId ?? null,
    activeWorktreeId: session.activeWorktreeId ?? null,
    browserUrlHistory: session.browserUrlHistory ?? defaults.browserUrlHistory,
    lastVisitedAtByWorktreeId: session.lastVisitedAtByWorktreeId,
    ...floatingSlice(session)
  }
}

/** The floating-workspace part of a sanitized session, for merging into a host-mirrored session. */
export function webFloatingWorkspaceSlice(
  session: WorkspaceSessionState
): Partial<WorkspaceSessionState> {
  return floatingSlice(session)
}
