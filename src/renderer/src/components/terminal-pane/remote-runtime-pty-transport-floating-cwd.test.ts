import { beforeEach, describe, expect, it } from 'vitest'
import type { IpcPtyTransportOptions } from './pty-transport-types'
import {
  createRemoteRuntimeTransportMocks,
  type MultiplexSubscriptionCallbacks
} from './remote-runtime-pty-transport-test-harness'

let subscriptionCallbacks: MultiplexSubscriptionCallbacks = null
let resolvedPaneHandle = 'terminal-1'

const { runtimeCall, resetRemoteRuntimeTransport } = createRemoteRuntimeTransportMocks({
  getCallbacks: () => subscriptionCallbacks,
  setCallbacks: (callbacks) => {
    subscriptionCallbacks = callbacks
  },
  getResolvedPaneHandle: () => resolvedPaneHandle,
  setResolvedPaneHandle: (handle) => {
    resolvedPaneHandle = handle
  }
})

const FLOATING = 'global-floating-terminal'

async function connectAndGetCreateParams(
  opts: IpcPtyTransportOptions,
  assignAfterConstruction?: Partial<IpcPtyTransportOptions>
): Promise<Record<string, unknown>> {
  runtimeCall.mockImplementation((args) =>
    Promise.resolve(
      args.method === 'terminal.create'
        ? { ok: true, result: { terminal: { handle: 'terminal-1' } } }
        : { ok: true, result: {} }
    )
  )
  const { createRemoteRuntimePtyTransport } = await import('./remote-runtime-pty-transport')
  const transport = createRemoteRuntimePtyTransport('env-1', opts)
  // Mirrors run-deferred-connect.ts: the pane sets cwd on the SAME options object after the
  // transport was built and before connect().
  Object.assign(opts, assignAfterConstruction)
  await transport.connect({ url: '', callbacks: {} })
  transport.destroy?.()
  const create = runtimeCall.mock.calls.find(([args]) => args.method === 'terminal.create')
  if (!create) {
    throw new Error('terminal.create was never called')
  }
  return create[0].params as Record<string, unknown>
}

describe('remote runtime pty transport: floating terminal cwd', () => {
  beforeEach(() => {
    resetRemoteRuntimeTransport()
  })

  it('sends the cwd on terminal.create for the floating terminal', async () => {
    const params = await connectAndGetCreateParams({
      worktreeId: FLOATING,
      tabId: 'tab-1',
      leafId: 'pane:1',
      cwd: '/home/coder/workspaces'
    })
    expect(params.worktree).toBe(`id:${FLOATING}`)
    expect(params.cwd).toBe('/home/coder/workspaces')
  })

  it('reads a cwd assigned AFTER the transport was constructed (deferred cwd)', async () => {
    const params = await connectAndGetCreateParams(
      { worktreeId: FLOATING, tabId: 'tab-1', leafId: 'pane:1' },
      { cwd: '/home/coder/workspaces' }
    )
    expect(params.cwd).toBe('/home/coder/workspaces')
  })

  it('never sends a cwd for an ordinary worktree pane', async () => {
    const params = await connectAndGetCreateParams({
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      leafId: 'pane:1',
      cwd: '/home/coder/workspaces'
    })
    expect(params).not.toHaveProperty('cwd')
  })

  it.each([undefined, '', '   '])(
    'sends no cwd for the floating terminal when it is %j',
    async (cwd) => {
      const params = await connectAndGetCreateParams({
        worktreeId: FLOATING,
        tabId: 'tab-1',
        leafId: 'pane:1',
        ...(cwd === undefined ? {} : { cwd })
      })
      expect(params).not.toHaveProperty('cwd')
    }
  )
})
