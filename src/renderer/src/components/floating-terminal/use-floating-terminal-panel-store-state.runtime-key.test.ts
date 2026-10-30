import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(hoisted.state)
}))
vi.mock('@/lib/client-creation-action-policy', () => ({
  getClientCreationActionPolicy: () => ({ 'managed-browser': { state: 'enabled' } })
}))
vi.mock('./floating-terminal-panel-inputs', () => ({
  selectFloatingTerminalPanelInputs: () => ({
    tabs: [],
    browserTabs: [],
    groups: [],
    unifiedTabs: [],
    floatingFiles: [],
    expandedPaneByTabId: {}
  })
}))

import { useFloatingTerminalPanelStoreState } from './use-floating-terminal-panel-store-state'

// Why an alias: the store is mocked above as a plain selector runner, so this "hook" needs no
// React; calling it under its `use…` name from a test helper would trip rules-of-hooks.
const readPanelStoreState = useFloatingTerminalPanelStoreState

function keyFor(state: Record<string, unknown>): string {
  hoisted.state = state
  return readPanelStoreState().runtimeEnvironmentKey
}

describe('floating terminal panel runtimeEnvironmentKey', () => {
  it('is empty while no runtime environment is known', () => {
    expect(keyFor({ settings: { floatingTerminalCwd: '~/workspaces' } })).toBe('')
    expect(keyFor({ settings: {}, runtimeEnvironments: [] })).toBe('')
  })

  it('reflects the paired environment even when the active-environment preference is null (web client)', () => {
    expect(
      keyFor({
        settings: { floatingTerminalCwd: '~/workspaces', activeRuntimeEnvironmentId: null },
        runtimeEnvironments: [{ id: 'env-1' }]
      })
    ).toBe('env-1')
  })

  it('changes when the environment list changes and is stable otherwise', () => {
    const one = keyFor({ settings: {}, runtimeEnvironments: [{ id: 'a' }] })
    const same = keyFor({ settings: {}, runtimeEnvironments: [{ id: 'a' }] })
    const two = keyFor({ settings: {}, runtimeEnvironments: [{ id: 'a' }, { id: 'b' }] })
    expect(same).toBe(one)
    expect(two).toBe('a,b')
    expect(two).not.toBe(one)
  })

  it('still exposes the stored directory the resolver is asked about', () => {
    hoisted.state = { settings: { floatingTerminalCwd: '~/workspaces' } }
    expect(readPanelStoreState().floatingTerminalCwd).toBe('~/workspaces')
  })
})
