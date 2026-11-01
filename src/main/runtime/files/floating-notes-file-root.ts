import {
  ensureDefaultFloatingWorkspacePath,
  getDefaultFloatingWorkspacePath
} from '../../ipc/floating-workspace-directory'

const PATH_SELECTOR_PREFIX = 'path:'

/**
 * The folder a `path:<this host's floating notes folder>` selector names, or null.
 * Why a selector of its own (aidev02): Orca Web keeps its floating Markdown notes in the same
 * app-owned folder desktop uses, but upstream resolves the floating sentinel itself to the
 * floating terminal directory. Only this host's exact folder answers, like chat scratch folders.
 */
export async function resolveFloatingNotesSelectorFolder(selector: string): Promise<string | null> {
  if (!selector.startsWith(PATH_SELECTOR_PREFIX)) {
    return null
  }
  if (selector.slice(PATH_SELECTOR_PREFIX.length) !== getDefaultFloatingWorkspacePath()) {
    return null
  }
  return ensureDefaultFloatingWorkspacePath()
}
