import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { createUntitledMarkdownFileWithTemplateSelection } from './create-untitled-markdown'
import { getConnectionId } from './connection-context'
import { getWebFloatingRuntimeOwner } from './terminal-worktree-route'
import { detectLanguage } from './language-detect'
import type { AppState } from '@/store/types'
import { focusTerminalTabSurface } from './focus-terminal-tab-surface'
import { createBrowserUuid } from './browser-uuid'
import { translate } from '@/i18n/i18n'
import { assertClientCreationActionAvailable } from './client-creation-action-policy'

type FloatingWorkspaceTerminalStore = Pick<AppState, 'activeGroupIdByWorktree' | 'createTab'>

type FloatingWorkspaceBrowserStore = Pick<
  AppState,
  'activeGroupIdByWorktree' | 'browserDefaultUrl' | 'createBrowserTab'
>

type FloatingWorkspaceMarkdownStore = Pick<AppState, 'activeGroupIdByWorktree' | 'openFile'>

export async function createFloatingWorkspaceTerminalTab(
  store: FloatingWorkspaceTerminalStore,
  shellOverride?: string,
  /** A split group's own "+"; omitted, the tab lands in the focused group. */
  groupId?: string
): Promise<void> {
  const targetGroupId = groupId ?? store.activeGroupIdByWorktree[FLOATING_TERMINAL_WORKTREE_ID]

  // Floating scratchpad terminals stay local; focused remote runtimes must not own or snapshot-prune them.
  const tabId = createBrowserUuid()
  store.createTab(FLOATING_TERMINAL_WORKTREE_ID, targetGroupId, shellOverride, { id: tabId })
  focusTerminalTabSurface(tabId)
}

export async function createFloatingWorkspaceBrowserTab(
  store: FloatingWorkspaceBrowserStore
): Promise<void> {
  assertClientCreationActionAvailable(
    store as AppState,
    FLOATING_TERMINAL_WORKTREE_ID,
    'managed-browser'
  )
  const targetGroupId = store.activeGroupIdByWorktree[FLOATING_TERMINAL_WORKTREE_ID]
  const url = store.browserDefaultUrl ?? 'about:blank'

  // Floating browsers follow terminals’ local-only ownership rule.
  store.createBrowserTab(FLOATING_TERMINAL_WORKTREE_ID, url, {
    title: translate('auto.lib.floating.workspace.tab.creation.f3785eddc2', 'New Browser Tab'),
    focusAddressBar: true,
    targetGroupId,
    browserRuntimeEnvironmentId: null
  })
}

export async function createFloatingWorkspaceMarkdownTab(
  store: FloatingWorkspaceMarkdownStore,
  markdownDirectory?: string | null
): Promise<void> {
  const targetGroupId = store.activeGroupIdByWorktree[FLOATING_TERMINAL_WORKTREE_ID]
  const floatingMarkdownDirectory =
    // Why: '' is an unresolved directory, not a choice; ask the app again.
    markdownDirectory || (await window.api.app.getFloatingMarkdownDirectory())
  if (!floatingMarkdownDirectory) {
    return
  }
  // Web: notes live on the paired runtime (Electron: null, stays local).
  const runtimeEnvironmentId = getWebFloatingRuntimeOwner()
  const fileInfo = await createUntitledMarkdownFileWithTemplateSelection(
    floatingMarkdownDirectory,
    FLOATING_TERMINAL_WORKTREE_ID,
    getConnectionId(FLOATING_TERMINAL_WORKTREE_ID) ?? undefined,
    runtimeEnvironmentId
      ? { kind: 'environment', environmentId: runtimeEnvironmentId }
      : { kind: 'local' }
  )
  if (!fileInfo) {
    return
  }
  store.openFile(
    {
      ...fileInfo,
      ...(runtimeEnvironmentId ? { runtimeEnvironmentId } : {}),
      language: detectLanguage(fileInfo.relativePath)
    },
    {
      preview: false,
      targetGroupId,
      // Why: a null owner hint would contradict the paired owner and fail the file open.
      suppressActiveRuntimeFallback: !runtimeEnvironmentId
    }
  )
}
