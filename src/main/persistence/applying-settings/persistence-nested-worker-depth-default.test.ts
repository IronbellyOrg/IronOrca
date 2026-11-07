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
import { resolveNestedWorkerMaxDepth } from '../../../shared/nested-worker-depth'

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

function legacyProfile(depth: number, guard?: boolean) {
  const persisted = getDefaultPersistedState(testState.dir)
  persisted.settings.nestedWorkerMaxDepth = depth
  if (guard === undefined) {
    delete persisted.settings.nestedWorkerMaxDepthDefaultedToTwo
  } else {
    persisted.settings.nestedWorkerMaxDepthDefaultedToTwo = guard
  }
  return persisted
}

describe('nested worker depth default', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('is 2 for a brand-new profile', async () => {
    const settings = (await createStore()).getSettings()
    expect(resolveNestedWorkerMaxDepth(settings)).toBe(2)
    expect(settings.nestedWorkerMaxDepthDefaultedToTwo).toBe(true)
  })

  it('moves a stored 1 from the old default to 2 once and saves it', async () => {
    writeDataFile(legacyProfile(1))
    const store = await createStore()
    expect(store.getSettings().nestedWorkerMaxDepth).toBe(2)
    store.flush()
    expect(readDataFile()).toHaveProperty('settings.nestedWorkerMaxDepth', 2)
    expect(readDataFile()).toHaveProperty('settings.nestedWorkerMaxDepthDefaultedToTwo', true)
  })

  it('keeps a stored value above 1', async () => {
    writeDataFile(legacyProfile(3))
    expect((await createStore()).getSettings().nestedWorkerMaxDepth).toBe(3)
  })

  it('keeps a 1 stored after the guard was set', async () => {
    writeDataFile(legacyProfile(1, true))
    expect((await createStore()).getSettings().nestedWorkerMaxDepth).toBe(1)
  })

  it('keeps an explicit 1 chosen after migration through save and reload', async () => {
    writeDataFile(legacyProfile(1))
    const store = await createStore()
    expect(store.getSettings().nestedWorkerMaxDepth).toBe(2)
    store.updateSettings({ nestedWorkerMaxDepth: 1 })
    store.flush()
    await closeTestStores()
    expect((await createStore()).getSettings().nestedWorkerMaxDepth).toBe(1)
  })

  it('stamps the guard on an explicit write so a 1 on an unguarded profile sticks', async () => {
    writeDataFile(legacyProfile(2, false))
    const store = await createStore()
    store.updateSettings({ nestedWorkerMaxDepth: 1 })
    expect(store.getSettings().nestedWorkerMaxDepthDefaultedToTwo).toBe(true)
    store.flush()
    await closeTestStores()
    expect((await createStore()).getSettings().nestedWorkerMaxDepth).toBe(1)
  })
})
