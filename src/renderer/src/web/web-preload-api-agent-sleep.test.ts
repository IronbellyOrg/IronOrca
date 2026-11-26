import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserGlobals } from './web-preload-api-test-harness'

const SETTINGS_KEY = 'orca.web.settings.v1'
type Globals = ReturnType<typeof installBrowserGlobals>
type SleepBlob = {
  experimentalAgentHibernation?: boolean
  agentHibernationDefaultedOn?: boolean
  agentHibernationIdleMs?: number
}

async function load(globals: Globals) {
  const { installWebPreloadApi } = await import('./web-preload-api')
  installWebPreloadApi()
  return globals.window.api.settings.get()
}

// Simulates a page reload: fresh module state, same browser storage.
async function reload(globals: Globals) {
  vi.resetModules()
  return load(globals)
}

function storedBlob(globals: Globals): SleepBlob {
  const blob: SleepBlob = JSON.parse(globals.storage.getItem(SETTINGS_KEY) ?? '{}')
  return blob
}

function seed(globals: Globals, blob: SleepBlob): void {
  globals.storage.setItem(SETTINGS_KEY, JSON.stringify(blob))
}

describe('web Agent sleep default-on', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is on with a 30 minute idle window when nothing is stored', async () => {
    const globals = installBrowserGlobals('Linux')
    const settings = await load(globals)
    expect(settings.experimentalAgentHibernation).toBe(true)
    expect(settings.agentHibernationIdleMs).toBe(1_800_000)
  })

  it('turns on a stored false and stores both the toggle and the marker', async () => {
    const globals = installBrowserGlobals('Linux')
    seed(globals, { experimentalAgentHibernation: false })
    const settings = await load(globals)
    expect(settings.experimentalAgentHibernation).toBe(true)
    expect(settings.agentHibernationDefaultedOn).toBe(true)
    expect(storedBlob(globals).experimentalAgentHibernation).toBe(true)
    expect(storedBlob(globals).agentHibernationDefaultedOn).toBe(true)
  })

  it('keeps a stored false once the marker is stored, across a second load', async () => {
    const globals = installBrowserGlobals('Linux')
    seed(globals, { experimentalAgentHibernation: false, agentHibernationDefaultedOn: true })
    expect((await load(globals)).experimentalAgentHibernation).toBe(false)
    expect((await reload(globals)).experimentalAgentHibernation).toBe(false)
    expect(storedBlob(globals).experimentalAgentHibernation).toBe(false)
    expect(storedBlob(globals).agentHibernationDefaultedOn).toBe(true)
  })

  it('keeps a stored custom idle window through the conversion', async () => {
    const globals = installBrowserGlobals('Linux')
    seed(globals, { experimentalAgentHibernation: false, agentHibernationIdleMs: 3_600_000 })
    const settings = await load(globals)
    expect(settings.experimentalAgentHibernation).toBe(true)
    expect(settings.agentHibernationIdleMs).toBe(3_600_000)
  })

  it('keeps a stored true on and adds the marker', async () => {
    const globals = installBrowserGlobals('Linux')
    seed(globals, { experimentalAgentHibernation: true })
    expect((await load(globals)).experimentalAgentHibernation).toBe(true)
    expect(storedBlob(globals).agentHibernationDefaultedOn).toBe(true)
  })

  it('converts again on the next load when the converted blob could not be saved', async () => {
    const globals = installBrowserGlobals('Linux')
    const original = globals.storage.setItem.bind(globals.storage)
    let quotaFull = false
    globals.storage.setItem = (key: string, value: string): void => {
      if (quotaFull && key === SETTINGS_KEY) {
        throw new Error('QuotaExceededError')
      }
      original(key, value)
    }
    seed(globals, { experimentalAgentHibernation: false })
    quotaFull = true

    await load(globals)
    expect(storedBlob(globals).experimentalAgentHibernation).toBe(false)
    expect(storedBlob(globals).agentHibernationDefaultedOn).toBeUndefined()

    quotaFull = false
    expect((await reload(globals)).experimentalAgentHibernation).toBe(true)
    expect(storedBlob(globals).experimentalAgentHibernation).toBe(true)
    expect(storedBlob(globals).agentHibernationDefaultedOn).toBe(true)
  })

  it('keeps an opt-out made through settings.set across a reload', async () => {
    const globals = installBrowserGlobals('Linux')
    await load(globals)
    await globals.window.api.settings.set({ experimentalAgentHibernation: false })
    expect(storedBlob(globals).agentHibernationDefaultedOn).toBe(true)
    expect((await reload(globals)).experimentalAgentHibernation).toBe(false)
  })

  it('keeps the marker set when an update tries to clear it', async () => {
    const globals = installBrowserGlobals('Linux')
    await load(globals)
    const updated = await globals.window.api.settings.set({
      experimentalAgentHibernation: false,
      agentHibernationDefaultedOn: false
    })
    expect(updated.agentHibernationDefaultedOn).toBe(true)
    expect(storedBlob(globals).experimentalAgentHibernation).toBe(false)
    expect(storedBlob(globals).agentHibernationDefaultedOn).toBe(true)
    expect((await reload(globals)).experimentalAgentHibernation).toBe(false)
  })
})
