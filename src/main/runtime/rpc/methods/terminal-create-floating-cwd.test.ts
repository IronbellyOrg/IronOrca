import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eraseRpcMethods, type RpcContext } from '../core'
import { TERMINAL_METHODS } from './terminal'

const hoisted = vi.hoisted(() => ({ fakeHome: '' }))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  homedir: () => hoisted.fakeHome
}))

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-floating-create-'))
  hoisted.fakeHome = join(root, 'server-home')
  mkdirSync(join(hoisted.fakeHome, 'workspaces'), { recursive: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// Drives the REAL terminal.create handler; only the runtime service is a recorder.
async function createVia(
  canonicalSelector: string,
  params: Record<string, unknown>,
  context: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const createTerminal = vi.fn(async () => ({ handle: 'term-1' }))
  const dedupeTerminalCreate = vi.fn(
    async (
      _owner: string,
      _worktree: string | undefined,
      _mutationId: string | undefined,
      _reconcile: boolean,
      run: (worktree: string | undefined, handle: string | undefined) => Promise<unknown>
    ) => run(canonicalSelector, undefined)
  )
  const method = eraseRpcMethods(TERMINAL_METHODS).find(
    (candidate) => candidate.name === 'terminal.create'
  )
  if (!method?.params) {
    throw new Error('terminal.create method missing')
  }
  await method.handler(
    method.params.parse({ worktree: canonicalSelector, ...params }),
    { runtime: { createTerminal, dedupeTerminalCreate }, ...context } as unknown as RpcContext,
    vi.fn()
  )
  expect(createTerminal).toHaveBeenCalledTimes(1)
  return (createTerminal.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
}

describe('terminal.create floating cwd', () => {
  const expanded = (): string => join(hoisted.fakeHome, 'workspaces')

  it('passes the EXPANDED absolute server path for the id: floating selector (what the web sends)', async () => {
    const options = await createVia('id:global-floating-terminal', { cwd: '~/workspaces' })
    expect(options.cwd).toBe(expanded())
    expect(options.cwd).not.toBe('~/workspaces')
    expect(String(options.cwd)).not.toContain('~')
  })

  it('also accepts the bare floating sentinel', async () => {
    const options = await createVia('global-floating-terminal', { cwd: '~/workspaces' })
    expect(options.cwd).toBe(expanded())
  })

  it.each(['~/does-not-exist', '', '   ', '~/work\0spaces'])(
    'forwards no cwd when the request cannot be launched into (%j)',
    async (cwd) => {
      const options = await createVia('id:global-floating-terminal', { cwd })
      expect(options).not.toHaveProperty('cwd')
    }
  )

  it('forwards no cwd when none was requested', async () => {
    const options = await createVia('id:global-floating-terminal', {})
    expect(options).not.toHaveProperty('cwd')
  })

  it('ignores cwd for an ordinary worktree selector', async () => {
    const options = await createVia('id:worktree-1', { cwd: '~/workspaces' })
    expect(options).not.toHaveProperty('cwd')
  })

  it('ignores cwd for a near-miss selector', async () => {
    const options = await createVia('id:global-floating-terminal-2', { cwd: '~/workspaces' })
    expect(options).not.toHaveProperty('cwd')
  })

  it('applies the same rule to a paired viewer (terminal.create is in the mobile allowlist)', async () => {
    const floating = await createVia(
      'id:global-floating-terminal',
      { cwd: '~/workspaces' },
      { pairedDeviceId: 'device-a', clientKind: 'runtime' }
    )
    expect(floating.cwd).toBe(expanded())
    const other = await createVia(
      'id:worktree-1',
      { cwd: '~/workspaces' },
      { pairedDeviceId: 'device-a', clientKind: 'runtime' }
    )
    expect(other).not.toHaveProperty('cwd')
  })
})
