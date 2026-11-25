import {
  closeTestStores,
  testState,
  createStore,
  writeDataFile,
  readDataFile
} from '../persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { getDefaultPersistedState } from '../../../shared/constants'
import { prepareLoadedProfileSettings } from '../loading-store/prepare-loaded-profile-settings'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))

// A profile as the old default saved it: Agent sleep off, with or without the new marker.
function savedProfile(options: {
  hibernation: boolean
  marker?: boolean
  idleMs?: number
}): PersistedState {
  const persisted = getDefaultPersistedState(testState.dir)
  persisted.settings.experimentalAgentHibernation = options.hibernation
  if (options.marker === undefined) {
    delete persisted.settings.agentHibernationDefaultedOn
  } else {
    persisted.settings.agentHibernationDefaultedOn = options.marker
  }
  if (options.idleMs !== undefined) {
    persisted.settings.agentHibernationIdleMs = options.idleMs
  }
  return persisted
}

describe('Agent sleep default-on migration', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('is on with the marker and a 30 minute idle window for a brand-new profile', async () => {
    const settings = (await createStore()).getSettings()
    expect(settings.experimentalAgentHibernation).toBe(true)
    expect(settings.agentHibernationDefaultedOn).toBe(true)
    expect(settings.agentHibernationIdleMs).toBe(1_800_000)
  })

  it('converts a saved false with no marker on the first load and saves it', async () => {
    writeDataFile(savedProfile({ hibernation: false }))
    const store = await createStore()
    expect(store.getSettings().experimentalAgentHibernation).toBe(true)
    expect(store.getSettings().agentHibernationDefaultedOn).toBe(true)
    store.flush()
    expect(readDataFile()).toHaveProperty('settings.experimentalAgentHibernation', true)
    expect(readDataFile()).toHaveProperty('settings.agentHibernationDefaultedOn', true)
  })

  it('keeps a saved false once the marker is set', async () => {
    writeDataFile(savedProfile({ hibernation: false, marker: true }))
    const settings = (await createStore()).getSettings()
    expect(settings.experimentalAgentHibernation).toBe(false)
    expect(settings.agentHibernationDefaultedOn).toBe(true)
  })

  it('keeps a stored custom idle window through the conversion', async () => {
    writeDataFile(savedProfile({ hibernation: false, idleMs: 3_600_000 }))
    const settings = (await createStore()).getSettings()
    expect(settings.experimentalAgentHibernation).toBe(true)
    expect(settings.agentHibernationIdleMs).toBe(3_600_000)
  })

  it('keeps a saved true with no marker on and adds the marker', async () => {
    writeDataFile(savedProfile({ hibernation: true }))
    const store = await createStore()
    expect(store.getSettings().experimentalAgentHibernation).toBe(true)
    expect(store.getSettings().agentHibernationDefaultedOn).toBe(true)
    store.flush()
    expect(readDataFile()).toHaveProperty('settings.agentHibernationDefaultedOn', true)
  })

  it('stamps the marker on an explicit opt-out so the false survives a reload', async () => {
    const store = await createStore()
    const updated = store.updateSettings({
      experimentalAgentHibernation: false,
      agentHibernationDefaultedOn: false
    })
    expect(updated.experimentalAgentHibernation).toBe(false)
    expect(updated.agentHibernationDefaultedOn).toBe(true)
    store.flush()
    await closeTestStores()
    expect((await createStore()).getSettings().experimentalAgentHibernation).toBe(false)
  })

  it('converts again on the next load when the first load never reached disk', async () => {
    writeDataFile(savedProfile({ hibernation: false }))
    await createStore()
    // Close without a flush: the pending save of the first load is dropped.
    await closeTestStores()
    expect(readDataFile()).toHaveProperty('settings.experimentalAgentHibernation', false)
    expect(readDataFile()).not.toHaveProperty('settings.agentHibernationDefaultedOn', true)

    const store = await createStore()
    expect(store.getSettings().experimentalAgentHibernation).toBe(true)
    expect(store.getSettings().agentHibernationDefaultedOn).toBe(true)
    store.flush()
    expect(readDataFile()).toHaveProperty('settings.experimentalAgentHibernation', true)
    expect(readDataFile()).toHaveProperty('settings.agentHibernationDefaultedOn', true)
  })

  it('asks for a save only because the marker is missing', () => {
    const defaults = getDefaultPersistedState(testState.dir)
    const withoutMarker = savedProfile({ hibernation: false })
    const withMarker = savedProfile({ hibernation: false, marker: true })
    const absentSpy = vi.fn()
    const presentSpy = vi.fn()
    prepareLoadedProfileSettings(withoutMarker, defaults, absentSpy)
    prepareLoadedProfileSettings(withMarker, defaults, presentSpy)
    expect(absentSpy.mock.calls.length).toBe(presentSpy.mock.calls.length + 1)
  })
})
