import { lstat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { RuntimeStore } from '../runtime-store-contract'
import {
  resolveAuthorizedPath,
  type ResolveAuthorizedPathOptions
} from '../../ipc/filesystem/filesystem-auth'
import { isENOENT } from '../../ipc/filesystem/filesystem-path-containment'
import { nativeChatScratchRootFor } from '../../native-chat/native-chat-scratch-folder'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { getDefaultFloatingWorkspacePath } from '../../ipc/floating-workspace-directory'

const PATH_SELECTOR_PREFIX = 'path:'
const SCRATCH_FOLDER_NAME = /^[0-9a-f]{32}$/

function chatScratchRoot(): string {
  return nativeChatScratchRootFor(getProfileUserDataPath())
}

/** aidev02: also authorize the app-owned floating notes folder, as desktop already does. */
export function resolveRuntimeAuthorizedPath(
  targetPath: string,
  store: RuntimeStore,
  options: ResolveAuthorizedPathOptions = {}
): Promise<string> {
  return resolveAuthorizedPath(targetPath, store, {
    ...options,
    extraRoots: [chatScratchRoot(), getDefaultFloatingWorkspacePath()]
  })
}

export function isChatScratchWorktreeId(worktreeId: string): boolean {
  return worktreeId.startsWith(PATH_SELECTOR_PREFIX)
}

/** Only this host's exact scratch-root/32-hex folder may answer; reject lookalike roots and symlinks. */
export async function resolveChatScratchSelectorFolder(selector: string): Promise<string | null> {
  if (!selector.startsWith(PATH_SELECTOR_PREFIX)) {
    return null
  }
  const folder = selector.slice(PATH_SELECTOR_PREFIX.length)
  if (dirname(folder) !== chatScratchRoot() || !SCRATCH_FOLDER_NAME.test(basename(folder))) {
    return null
  }
  try {
    return (await lstat(folder)).isDirectory() ? folder : null
  } catch (error) {
    if (isENOENT(error)) {
      return null
    }
    throw error
  }
}
