import { constants as fsConstants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Dirent } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import type { DirEntry, FilesystemPathFlavor } from '../../shared/filesystem-entry-types'
import { sortDirEntries } from '../../shared/file-name-sort'
import { probeGitAvailability } from '../git/git-availability'
import { gitExecFileAsync } from '../git/runner'
import { isServerDriveListRequest, listWindowsDrives } from './windows-drive-listing'

export function resolveServerBrowsePath(pathValue: string): string {
  const trimmed = pathValue.trim() || '~'
  if (trimmed.includes('\0')) {
    throw new Error('Path cannot contain null bytes')
  }
  if (trimmed === '~') {
    return homedir()
  }
  if (/^~[\\/]/.test(trimmed)) {
    return resolve(homedir(), trimmed.slice(2))
  }
  if (isAbsolute(trimmed)) {
    return resolve(trimmed)
  }
  return resolve(homedir(), trimmed)
}

// Follow symlinked directories; Dirent alone reports false. Broken/looped links remain files (ENOENT/ELOOP).
async function isBrowseEntryDirectory(dirPath: string, entry: Dirent): Promise<boolean> {
  if (entry.isDirectory()) {
    return true
  }
  if (!entry.isSymbolicLink()) {
    return false
  }
  try {
    return (await stat(join(dirPath, entry.name))).isDirectory()
  } catch {
    return false
  }
}

/** True only for the floating-terminal sentinel in the two forms a client may send (bare id, or the `id:` selector the web transport sends). */
export function isFloatingTerminalSelector(selector: string | undefined): boolean {
  return (
    selector === FLOATING_TERMINAL_WORKTREE_ID || selector === `id:${FLOATING_TERMINAL_WORKTREE_ID}`
  )
}

/**
 * Absolute, existing, readable directory for a floating terminal to start in, or undefined.
 * Why this expands here: the launch path joins any non-absolute cwd onto the server home
 * (resolveTerminalStartupCwd), so a raw `~/workspaces` would become `<home>/~/workspaces`.
 * Undefined means "keep the default" (the server home), never an error.
 */
export async function resolveFloatingLaunchCwd(
  requested: string | undefined
): Promise<string | undefined> {
  if (typeof requested !== 'string' || requested.trim() === '') {
    return undefined
  }
  try {
    const dirPath = resolveServerBrowsePath(requested)
    if (!(await stat(dirPath)).isDirectory()) {
      return undefined
    }
    await access(dirPath, fsConstants.R_OK | fsConstants.X_OK)
    return dirPath
  } catch {
    return undefined
  }
}

export class RuntimeServerEnvironmentCommands {
  async browseDirectory(pathValue: string): Promise<{
    resolvedPath: string
    entries: DirEntry[]
    pathFlavor: FilesystemPathFlavor
  }> {
    if (isServerDriveListRequest(pathValue)) {
      return listWindowsDrives()
    }
    const dirPath = resolveServerBrowsePath(pathValue)
    const dirStat = await stat(dirPath)
    if (!dirStat.isDirectory()) {
      throw new Error(`${dirPath} is not a directory`)
    }
    const entries = await readdir(dirPath, { withFileTypes: true })
    const mapped = await Promise.all(
      entries
        .filter((entry) => entry.name !== '.' && entry.name !== '..')
        .map(async (entry) => ({
          name: entry.name,
          isDirectory: await isBrowseEntryDirectory(dirPath, entry),
          isSymlink: entry.isSymbolicLink()
        }))
    )
    sortDirEntries(mapped)
    return {
      resolvedPath: dirPath,
      entries: mapped,
      pathFlavor: process.platform === 'win32' ? 'win32' : 'posix'
    }
  }

  async isGitAvailable(): Promise<boolean> {
    return probeGitAvailability(gitExecFileAsync, { cwd: process.cwd(), timeout: 3000 })
  }
}
