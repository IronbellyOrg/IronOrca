import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { installBrowserGlobals } from './web-preload-api-test-harness'
import { computeFloatingWorkspaceUpgrade } from './preload-api/web-floating-workspace'

const SETTINGS_KEY = 'orca.web.settings.v1'
const MARKER_KEY = 'orca.web.floatingWorkspaceDefaults.v1'

type FloatingSettings = Pick<GlobalSettings, 'floatingTerminalEnabled' | 'floatingTerminalCwd'>

async function installAndRead(
  globals: ReturnType<typeof installBrowserGlobals>
): Promise<FloatingSettings> {
  const { installWebPreloadApi } = await import('./web-preload-api')
  installWebPreloadApi()
  return globals.window.api.settings.get() as Promise<FloatingSettings>
}

// Simulates a page reload: fresh module state, same browser storage.
async function reload(
  globals: ReturnType<typeof installBrowserGlobals>
): Promise<FloatingSettings> {
  vi.resetModules()
  return installAndRead(globals)
}

function storedBlob(globals: ReturnType<typeof installBrowserGlobals>): Partial<FloatingSettings> {
  return JSON.parse(globals.storage.getItem(SETTINGS_KEY) ?? '{}') as Partial<FloatingSettings>
}

describe('web floating workspace defaults', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('enables the floating workspace in ~/workspaces for a new user, without writing settings', async () => {
    const globals = installBrowserGlobals('Linux')
    const settings = await installAndRead(globals)

    expect(settings.floatingTerminalEnabled).toBe(true)
    expect(settings.floatingTerminalCwd).toBe('~/workspaces')
    expect(globals.storage.getItem(MARKER_KEY)).toBe('1')
    expect(globals.storage.getItem(SETTINGS_KEY)).toBeNull()
  })

  it('leaves the shared (desktop) default directory alone', () => {
    expect(getDefaultSettings('~').floatingTerminalCwd).toBe('~')
    expect(getDefaultSettings('~').floatingTerminalEnabled).toBe(true)
  })

  it('upgrades the old forced web defaults once and persists the result', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ floatingTerminalEnabled: false, floatingTerminalCwd: '~' })
    )
    const settings = await installAndRead(globals)

    expect(settings.floatingTerminalEnabled).toBe(true)
    expect(settings.floatingTerminalCwd).toBe('~/workspaces')
    expect(storedBlob(globals)).toMatchObject({
      floatingTerminalEnabled: true,
      floatingTerminalCwd: '~/workspaces'
    })
    expect(globals.storage.getItem(MARKER_KEY)).toBe('1')
  })

  it.each([
    ['an empty directory', { floatingTerminalCwd: '' }, '~/workspaces'],
    ['the old ~ default', { floatingTerminalCwd: '~' }, '~/workspaces'],
    ['a deliberately chosen directory', { floatingTerminalCwd: '/srv/projects' }, '/srv/projects']
  ])('handles %s', async (_label, blob, expectedCwd) => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(SETTINGS_KEY, JSON.stringify(blob))
    const settings = await installAndRead(globals)
    expect(settings.floatingTerminalCwd).toBe(expectedCwd)
    expect(storedBlob(globals).floatingTerminalCwd).toBe(expectedCwd)
  })

  // The full table from the spec: enabled {true, false, missing} x cwd {'', '~', custom, missing},
  // each with the marker absent (first run: upgrade) and present (stored values are authoritative).
  const ENABLED = { true: true, false: false, missing: undefined } as const
  const CWD = { empty: '', tilde: '~', custom: '/srv/projects', missing: undefined } as const
  type EnabledKey = keyof typeof ENABLED
  type CwdKey = keyof typeof CWD
  const rows: [EnabledKey, CwdKey][] = (Object.keys(ENABLED) as EnabledKey[]).flatMap((e) =>
    (Object.keys(CWD) as CwdKey[]).map((c): [EnabledKey, CwdKey] => [e, c])
  )

  it.each(rows)('first run (no marker): enabled=%s cwd=%s', async (e, c) => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        compactWorktreeCards: true, // an unrelated key so the blob always exists
        ...(ENABLED[e] === undefined ? {} : { floatingTerminalEnabled: ENABLED[e] }),
        ...(CWD[c] === undefined ? {} : { floatingTerminalCwd: CWD[c] })
      })
    )
    const settings = await installAndRead(globals)

    // enabled: only an explicit stored false is changed; everything else ends up true.
    expect(settings.floatingTerminalEnabled).toBe(true)
    // cwd: '' / '~' / missing become the web default; a chosen directory is kept.
    expect(settings.floatingTerminalCwd).toBe(c === 'custom' ? '/srv/projects' : '~/workspaces')
    // Persisted: a stored '' / '~' is rewritten; a chosen directory is kept; a missing key stays
    // missing (defaults are applied when settings are read, not written back).
    if (c === 'missing') {
      expect(storedBlob(globals)).not.toHaveProperty('floatingTerminalCwd')
    } else {
      expect(storedBlob(globals).floatingTerminalCwd).toBe(settings.floatingTerminalCwd)
    }
  })

  it.each(rows)('marker present: enabled=%s cwd=%s is authoritative', async (e, c) => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(MARKER_KEY, '1')
    globals.storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        compactWorktreeCards: true,
        ...(ENABLED[e] === undefined ? {} : { floatingTerminalEnabled: ENABLED[e] }),
        ...(CWD[c] === undefined ? {} : { floatingTerminalCwd: CWD[c] })
      })
    )
    const settings = await installAndRead(globals)

    // Stored values win exactly as stored; a missing key falls back to the web defaults.
    expect(settings.floatingTerminalEnabled).toBe(ENABLED[e] ?? true)
    expect(settings.floatingTerminalCwd).toBe(CWD[c] ?? '~/workspaces')
  })

  it('keeps an explicit enabled=true and a chosen directory untouched', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ floatingTerminalEnabled: true, floatingTerminalCwd: '/srv/projects' })
    )
    const settings = await installAndRead(globals)
    expect(settings).toMatchObject({
      floatingTerminalEnabled: true,
      floatingTerminalCwd: '/srv/projects'
    })
  })

  it('upgrades a stored false but keeps a chosen directory (the two rows are independent)', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ floatingTerminalEnabled: false, floatingTerminalCwd: '/srv/projects' })
    )
    const settings = await installAndRead(globals)
    expect(settings).toMatchObject({
      floatingTerminalEnabled: true,
      floatingTerminalCwd: '/srv/projects'
    })
  })

  it('treats stored values as authoritative once the marker is set', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(MARKER_KEY, '1')
    globals.storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ floatingTerminalEnabled: false, floatingTerminalCwd: '~' })
    )
    const settings = await installAndRead(globals)
    expect(settings.floatingTerminalEnabled).toBe(false)
    expect(settings.floatingTerminalCwd).toBe('~')
  })

  it('keeps the user choice to turn it off across reloads (never re-upgraded)', async () => {
    const globals = installBrowserGlobals('Linux')
    globals.storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ floatingTerminalEnabled: false, floatingTerminalCwd: '~' })
    )
    expect((await installAndRead(globals)).floatingTerminalEnabled).toBe(true)

    await globals.window.api.settings.set({ floatingTerminalEnabled: false })
    const afterReload = await reload(globals)

    expect(afterReload.floatingTerminalEnabled).toBe(false)
    expect(afterReload.floatingTerminalCwd).toBe('~/workspaces')
    expect((await reload(globals)).floatingTerminalEnabled).toBe(false)
  })

  it('does not throw or re-flip a later choice when the marker cannot be written', async () => {
    const globals = installBrowserGlobals('Linux')
    const original = globals.storage.setItem.bind(globals.storage)
    globals.storage.setItem = (key: string, value: string): void => {
      if (key === MARKER_KEY) {
        throw new Error('storage blocked')
      }
      original(key, value)
    }
    globals.storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ floatingTerminalEnabled: false, floatingTerminalCwd: '~' })
    )

    const settings = await installAndRead(globals)
    expect(settings.floatingTerminalEnabled).toBe(true)

    // Same page: the user turns it off; a second read must not undo that.
    await globals.window.api.settings.set({ floatingTerminalEnabled: false })
    expect((await globals.window.api.settings.get()).floatingTerminalEnabled).toBe(false)
  })

  it('retries the upgrade on the next load when the upgraded settings could not be saved', async () => {
    const globals = installBrowserGlobals('Linux')
    const original = globals.storage.setItem.bind(globals.storage)
    let quotaFull = false
    globals.storage.setItem = (key: string, value: string): void => {
      if (quotaFull && key === SETTINGS_KEY) {
        throw new Error('QuotaExceededError')
      }
      original(key, value)
    }
    globals.storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ floatingTerminalEnabled: false, floatingTerminalCwd: '~' })
    )
    quotaFull = true

    // Nothing could be persisted (this page may keep showing the old values: re-applying the
    // upgrade in-page could re-flip a choice the user makes afterwards)...
    await installAndRead(globals)
    expect(storedBlob(globals)).toMatchObject({
      floatingTerminalEnabled: false,
      floatingTerminalCwd: '~'
    })
    // ...so the marker must not claim the upgrade happened.
    expect(globals.storage.getItem(MARKER_KEY)).toBeNull()

    quotaFull = false
    const afterReload = await reload(globals)
    expect(afterReload.floatingTerminalEnabled).toBe(true)
    expect(afterReload.floatingTerminalCwd).toBe('~/workspaces')
    expect(storedBlob(globals)).toMatchObject({
      floatingTerminalEnabled: true,
      floatingTerminalCwd: '~/workspaces'
    })
    expect(globals.storage.getItem(MARKER_KEY)).toBe('1')
  })
})

describe('computeFloatingWorkspaceUpgrade', () => {
  it('leaves a stored false alone when the contested row is switched off, and still upgrades the directory', () => {
    const stored = { floatingTerminalEnabled: false, floatingTerminalCwd: '~' } as const
    expect(computeFloatingWorkspaceUpgrade(stored, { upgradeStoredDisabled: false })).toEqual({
      floatingTerminalCwd: '~/workspaces'
    })
    expect(computeFloatingWorkspaceUpgrade(stored, { upgradeStoredDisabled: true })).toEqual({
      floatingTerminalEnabled: true,
      floatingTerminalCwd: '~/workspaces'
    })
  })

  it('only touches values that match the old forced defaults', () => {
    expect(computeFloatingWorkspaceUpgrade({})).toEqual({})
    expect(computeFloatingWorkspaceUpgrade({ floatingTerminalEnabled: true })).toEqual({})
    expect(computeFloatingWorkspaceUpgrade({ floatingTerminalCwd: '/srv/x' })).toEqual({})
    expect(
      computeFloatingWorkspaceUpgrade({ floatingTerminalEnabled: false, floatingTerminalCwd: '~' })
    ).toEqual({ floatingTerminalEnabled: true, floatingTerminalCwd: '~/workspaces' })
  })
})
