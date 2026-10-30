import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { FLOATING_WORKSPACE_DEFAULTS_STORAGE_KEY } from './web-storage'

/**
 * Where the web client's floating terminal starts. It stays the literal `~/workspaces`: the
 * runtime server expands it against ITS home, never the browser machine's.
 */
export const WEB_FLOATING_WORKSPACE_DEFAULT_CWD = '~/workspaces'

/**
 * The one contested row of the upgrade: a stored `floatingTerminalEnabled: false`.
 * Why it is upgraded: the web client used to force that value and persists the whole settings
 * object on every change (writeStoredSettings), so a stored `false` is almost always the old forced
 * default, not a choice. Set this to false to leave every stored `false` untouched.
 */
export const UPGRADE_STORED_DISABLED = true

type FloatingWorkspaceUpgrade = Partial<
  Pick<GlobalSettings, 'floatingTerminalEnabled' | 'floatingTerminalCwd'>
>

// Why a per-page flag in addition to the storage marker: if the marker cannot be written
// (blocked storage) the upgrade must still never run twice in one page and re-flip a later choice.
let upgradeHandledThisPage = false

/** Corrections for values that are indistinguishable from the old forced web defaults. */
export function computeFloatingWorkspaceUpgrade(
  stored: Partial<GlobalSettings>,
  options: { upgradeStoredDisabled?: boolean } = {}
): FloatingWorkspaceUpgrade {
  const { upgradeStoredDisabled = UPGRADE_STORED_DISABLED } = options
  const upgrade: FloatingWorkspaceUpgrade = {}
  if (upgradeStoredDisabled && stored.floatingTerminalEnabled === false) {
    upgrade.floatingTerminalEnabled = true
  }
  // The web client could not change the directory (its picker is a stub), so '' and '~' are the
  // old default, never a choice. Anything else was set deliberately and is kept.
  if (stored.floatingTerminalCwd === '' || stored.floatingTerminalCwd === '~') {
    upgrade.floatingTerminalCwd = WEB_FLOATING_WORKSPACE_DEFAULT_CWD
  }
  return upgrade
}

/**
 * The upgrade to apply to the stored settings blob, at most once per browser and once per page.
 * Returns {} when it already ran. Never throws.
 *
 * Why this only touches raw storage: it runs inside getStoredSettings, and other readers
 * (readLocalWebUIState) re-enter getStoredSettings, so calling them from here would recurse.
 */
export function takeFloatingWorkspaceUpgrade(
  stored: Partial<GlobalSettings>
): FloatingWorkspaceUpgrade {
  if (upgradeHandledThisPage) {
    return {}
  }
  upgradeHandledThisPage = true
  try {
    if (window.localStorage.getItem(FLOATING_WORKSPACE_DEFAULTS_STORAGE_KEY) !== null) {
      return {}
    }
    const upgrade = computeFloatingWorkspaceUpgrade(stored)
    try {
      window.localStorage.setItem(FLOATING_WORKSPACE_DEFAULTS_STORAGE_KEY, '1')
    } catch {
      // Blocked storage: the per-page flag above still prevents a second run.
    }
    return upgrade
  } catch {
    return {}
  }
}

/**
 * Forget that the upgrade ran. getStoredSettings calls this when persisting the upgraded blob
 * failed (e.g. storage quota): the marker was already set, so without this the next load would
 * skip the upgrade for good while the stored blob still holds the old forced values.
 */
export function revertFloatingWorkspaceUpgradeMarker(): void {
  try {
    window.localStorage.removeItem(FLOATING_WORKSPACE_DEFAULTS_STORAGE_KEY)
  } catch {
    // Blocked storage: no marker was persisted, so there is none to undo.
  }
}
