import { isFloatingWorkspaceId } from '../../../shared/floating-workspace-worktree'
import { relativePathInsideRoot } from '../../../shared/cross-platform-path'

// `<host userData>/floating-workspace/<file>`, spelled with the host's own separators.
const FLOATING_NOTES_FILE = /^(.+?[\\/]floating-workspace)[\\/].+$/

export type FloatingNotesFileAddress = {
  /** The host's notes folder exactly as it spelled it; the host answers only its own. */
  root: string
  worktreeSelector: `path:${string}`
  relativePath: string
}

/**
 * How a host addresses a floating-workspace note (aidev02). Upstream resolves the floating
 * sentinel to the floating terminal directory, so notes kept in the host's app-owned notes folder
 * are addressed by that folder instead, mirroring chat scratch files.
 */
export function floatingNotesFileAddress(
  worktreeId: string | null | undefined,
  absolutePath: string
): FloatingNotesFileAddress | null {
  if (!isFloatingWorkspaceId(worktreeId)) {
    return null
  }
  const root = FLOATING_NOTES_FILE.exec(absolutePath)?.[1]
  const relativePath = root ? relativePathInsideRoot(root, absolutePath) : null
  return root && relativePath ? { root, worktreeSelector: `path:${root}`, relativePath } : null
}

/** The `path:` selector for a floating workspace rooted at the host's notes folder, or null. */
export function floatingNotesRootSelector(
  worktreeId: string | null | undefined,
  worktreePath: string | null | undefined
): `path:${string}` | null {
  return isFloatingWorkspaceId(worktreeId) &&
    worktreePath &&
    /[\\/]floating-workspace$/.test(worktreePath)
    ? `path:${worktreePath}`
    : null
}
