import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

const SERVER_NOTES_DIR = '/srv/user-data/floating-workspace'

const hoisted = vi.hoisted(() => ({
  calls: [] as { target: unknown; method: string }[],
  mode: 'up' as 'up' | 'down'
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

// A fake runtime that answers files.floatingMarkdownDirectory the way the server method does
// (the path ensureDefaultFloatingWorkspacePath returns). Only the RPC client is replaced.
vi.mock('../runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callRuntimeRpc: vi.fn(async (target: unknown, method: string) => {
    hoisted.calls.push({ target, method })
    if (hoisted.mode === 'down') {
      throw new Error('runtime unreachable')
    }
    if (method !== 'files.floatingMarkdownDirectory') {
      throw new Error(`unexpected method ${method}`)
    }
    return { path: SERVER_NOTES_DIR }
  })
}))

async function install(pair: boolean) {
  const globals = installBrowserGlobals('Linux')
  if (pair) {
    writeStoredRuntimeEnvironment(globals.storage)
  }
  const { installWebPreloadApi } = await import('./web-preload-api')
  installWebPreloadApi()
  return globals
}

describe('web getFloatingMarkdownDirectory (#325)', () => {
  beforeEach(() => {
    vi.resetModules()
    hoisted.calls.length = 0
    hoisted.mode = 'up'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the paired server notes directory (was always an empty string)', async () => {
    await install(true)
    await expect(window.api.app.getFloatingMarkdownDirectory()).resolves.toBe(SERVER_NOTES_DIR)
    expect(hoisted.calls).toEqual([
      {
        target: expect.objectContaining({ kind: 'environment' }),
        method: 'files.floatingMarkdownDirectory'
      }
    ])
  })

  it('returns an empty string before pairing, without calling the server', async () => {
    await install(false)
    await expect(window.api.app.getFloatingMarkdownDirectory()).resolves.toBe('')
    expect(hoisted.calls).toEqual([])
  })

  it('returns an empty string, never rejects, when the server does not answer', async () => {
    hoisted.mode = 'down'
    await install(true)
    await expect(window.api.app.getFloatingMarkdownDirectory()).resolves.toBe('')
  })
})
