import { useCallback } from 'react'
import { toast } from 'sonner'
import { resolveGroupTabFromVisibleId } from '@/components/tab-group/tab-group-visible-id'
import { getConnectionId } from '@/lib/connection-context'
import { createUntitledMarkdownFileWithTemplateSelection } from '@/lib/create-untitled-markdown'
import { ensureClientCreationActionAllowed } from '@/lib/client-creation-action-error'
import { openDocumentInFloatingWorkspace } from '@/lib/open-document-in-floating-workspace'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getWebFloatingRuntimeOwner } from '@/lib/terminal-worktree-route'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { FloatingWorkspaceChromeModel } from './use-floating-workspace-chrome-model'
import type { FloatingTerminalPanelLocalState } from './use-floating-terminal-panel-local-state'
import type { FloatingTerminalPanelStoreState } from './use-floating-terminal-panel-store-state'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

const LOCAL_TARGET: RuntimeClientTarget = { kind: 'local' }

type FloatingTerminalCreateActionsInput = Pick<
  FloatingTerminalPanelStoreState,
  | 'activateTab'
  | 'setActiveTab'
  | 'createTab'
  | 'createBrowserTab'
  | 'browserDefaultUrl'
  | 'openFile'
> &
  Pick<FloatingWorkspaceChromeModel, 'activeGroup' | 'groupTabs'> &
  Pick<FloatingTerminalPanelLocalState, 'markdownCwd'>

export function useFloatingTerminalCreateActions({
  activateTab,
  setActiveTab,
  createTab,
  createBrowserTab,
  browserDefaultUrl,
  openFile,
  activeGroup,
  groupTabs,
  markdownCwd
}: FloatingTerminalCreateActionsInput) {
  const activateFloatingItem = useCallback(
    (visibleId: string) => {
      const item = resolveGroupTabFromVisibleId(groupTabs, visibleId)
      if (!item) {
        return
      }
      activateTab(item.id)
      if (item.contentType === 'terminal') {
        setActiveTab(item.entityId)
        focusTerminalTabSurface(item.entityId)
      } else if (item.contentType === 'browser') {
        const workspace = useAppStore
          .getState()
          .browserTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.find(
            (tab) => tab.id === item.entityId
          )
        if (workspace?.activePageId && window.api?.browser) {
          void window.api.browser.notifyActiveTabChanged({ browserPageId: workspace.activePageId })
        }
      }
    },
    [activateTab, groupTabs, setActiveTab]
  )

  const createFloatingTerminalTab = useCallback(
    (shellOverride?: string) => {
      const tabId = createBrowserUuid()
      createTab(FLOATING_TERMINAL_WORKTREE_ID, activeGroup?.id, shellOverride, { id: tabId })
      focusTerminalTabSurface(tabId)
    },
    [activeGroup, createTab]
  )

  const createFloatingBrowserTab = useCallback(() => {
    if (!ensureClientCreationActionAllowed(FLOATING_TERMINAL_WORKTREE_ID, 'managed-browser')) {
      return
    }
    const url = browserDefaultUrl ?? 'about:blank'
    createBrowserTab(FLOATING_TERMINAL_WORKTREE_ID, url, {
      title: translate(
        'auto.components.floating.terminal.FloatingTerminalPanel.8b14ba6c17',
        'New Browser Tab'
      ),
      focusAddressBar: true,
      targetGroupId: activeGroup?.id,
      browserRuntimeEnvironmentId: null
    })
  }, [activeGroup, browserDefaultUrl, createBrowserTab])

  const createFloatingMarkdownTab = useCallback(() => {
    void (async () => {
      try {
        // Why: '' means the directory was not resolved (web: server not answering yet); ask again
        // so a click after it recovers works without remounting the panel.
        const directory = markdownCwd || (await window.api.app.getFloatingMarkdownDirectory())
        if (!directory) {
          // Why: an unresolved notes directory used to make this a silent no-op on web.
          toast.error(
            translate(
              'auto.components.floating.terminal.FloatingTerminalPanel.notes-directory-unavailable',
              'The floating notes directory is not available yet. Try again in a moment.'
            )
          )
          return
        }
        // Web: notes live on the paired runtime (Electron: null, stays local).
        const runtimeEnvironmentId = getWebFloatingRuntimeOwner()
        const fileInfo = await createUntitledMarkdownFileWithTemplateSelection(
          directory,
          FLOATING_TERMINAL_WORKTREE_ID,
          getConnectionId(FLOATING_TERMINAL_WORKTREE_ID) ?? undefined,
          runtimeEnvironmentId
            ? { kind: 'environment', environmentId: runtimeEnvironmentId }
            : LOCAL_TARGET
        )
        if (!fileInfo) {
          return
        }
        openFile(runtimeEnvironmentId ? { ...fileInfo, runtimeEnvironmentId } : fileInfo, {
          preview: false,
          targetGroupId: activeGroup?.id,
          // Why: a null owner hint would contradict the paired owner and fail the file open.
          suppressActiveRuntimeFallback: !runtimeEnvironmentId
        })
      } catch (error) {
        toast.error(extractIpcErrorMessage(error, 'Failed to create untitled markdown file.'))
      }
    })()
  }, [activeGroup, markdownCwd, openFile])

  const openFloatingMarkdownTab = useCallback(() => {
    void (async () => {
      try {
        const document = await window.api.app.pickFloatingMarkdownDocument()
        if (!document) {
          return
        }
        openDocumentInFloatingWorkspace(openFile, document, {
          targetGroupId: activeGroup?.id
        })
      } catch (error) {
        toast.error(extractIpcErrorMessage(error, 'Failed to open markdown file.'))
      }
    })()
  }, [activeGroup, openFile])

  return {
    activateFloatingItem,
    createFloatingTerminalTab,
    createFloatingBrowserTab,
    createFloatingMarkdownTab,
    openFloatingMarkdownTab
  }
}

export type FloatingTerminalCreateActions = ReturnType<typeof useFloatingTerminalCreateActions>
