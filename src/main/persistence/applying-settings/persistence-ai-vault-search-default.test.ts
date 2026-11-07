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
import { getDefaultPersistedState } from '../../../shared/constants'
import { resolveAiVaultSearchSettings } from '../../../shared/ai-vault-search-settings'

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

const SHIPPED = { enabled: true, historyDays: 15 }

describe('session search default', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('is on with the shipped history bound when the profile has no stored value', async () => {
    const withoutKey = getDefaultPersistedState(testState.dir)
    delete withoutKey.settings.aiVaultSearch
    writeDataFile(withoutKey)
    expect(resolveAiVaultSearchSettings((await createStore()).getSettings())).toEqual(SHIPPED)
  })

  it('is on for a brand-new profile', async () => {
    expect(resolveAiVaultSearchSettings((await createStore()).getSettings())).toEqual(SHIPPED)
  })

  it('keeps a stored off through load and a second reload', async () => {
    writeDataFile({ settings: { aiVaultSearch: { enabled: false, historyDays: null } } })
    const store = await createStore()
    expect(store.getSettings().aiVaultSearch).toEqual({ enabled: false, historyDays: null })
    store.flush()
    await closeTestStores()
    const reopened = await createStore()
    expect(reopened.getSettings().aiVaultSearch).toEqual({ enabled: false, historyDays: null })
  })

  it('reads a stored object without enabled as off instead of merging the default in', async () => {
    writeDataFile({ settings: { aiVaultSearch: { historyDays: 30 } } })
    const settings = (await createStore()).getSettings()
    expect(resolveAiVaultSearchSettings(settings)).toEqual({ enabled: false, historyDays: 30 })
  })

  it('stays off after default-on, toggle off, save and reload', async () => {
    const store = await createStore()
    expect(resolveAiVaultSearchSettings(store.getSettings()).enabled).toBe(true)
    store.updateSettings({ aiVaultSearch: { enabled: false, historyDays: 15 } })
    store.flush()
    expect(readDataFile()).toHaveProperty('settings.aiVaultSearch', {
      enabled: false,
      historyDays: 15
    })
    await closeTestStores()
    const reopened = await createStore()
    expect(resolveAiVaultSearchSettings(reopened.getSettings())).toEqual({
      enabled: false,
      historyDays: 15
    })
  })

  it('writes the merged default back on save, so it becomes a stored value', async () => {
    const withoutKey = getDefaultPersistedState(testState.dir)
    delete withoutKey.settings.aiVaultSearch
    writeDataFile(withoutKey)
    const store = await createStore()
    store.updateSettings({ theme: 'dark' })
    store.flush()
    expect(readDataFile()).toHaveProperty('settings.aiVaultSearch', SHIPPED)
  })
})
