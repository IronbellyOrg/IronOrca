// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFloatingTerminalPanelGeometry } from './use-floating-terminal-panel-geometry'

type GeometryInput = Parameters<typeof useFloatingTerminalPanelGeometry>[0]

function Probe({ input }: { input: GeometryInput }): null {
  useFloatingTerminalPanelGeometry(input)
  return null
}

const getFloatingTerminalCwd = vi.fn<(args?: { path?: string }) => Promise<string>>()
const getFloatingMarkdownDirectory = vi.fn<() => Promise<string>>()
const setCwd = vi.fn<(cwd: string) => void>()

function makeInput(overrides: Partial<GeometryInput> = {}): GeometryInput {
  return {
    boundsSourceRef: { current: 'default' },
    committedBoundsRef: { current: null },
    setBounds: vi.fn(),
    maximized: false,
    stagedBoundsRef: { current: null },
    lastPersistedBoundsRef: { current: null },
    setFloatingWorkspacePath: setCwd,
    setMarkdownCwd: vi.fn(),
    floatingTerminalCwd: '~/workspaces',
    runtimeEnvironmentKey: '',
    ...overrides
  } as unknown as GeometryInput
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('floating terminal panel cwd resolution', () => {
  let container: HTMLDivElement
  let root: Root

  function render(input: GeometryInput): void {
    act(() => {
      root.render(<Probe input={input} />)
    })
  }

  beforeEach(() => {
    getFloatingTerminalCwd.mockReset()
    getFloatingMarkdownDirectory.mockReset().mockResolvedValue('')
    setCwd.mockReset()
    ;(window as unknown as { api: unknown }).api = {
      app: { getFloatingTerminalCwd, getFloatingMarkdownDirectory }
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('resolves the stored directory once on mount', async () => {
    getFloatingTerminalCwd.mockResolvedValue('/srv/home/workspaces')
    render(makeInput())
    await flush()

    expect(getFloatingTerminalCwd).toHaveBeenCalledTimes(1)
    expect(getFloatingTerminalCwd).toHaveBeenCalledWith({ path: '~/workspaces' })
    expect(setCwd).toHaveBeenCalledWith('/srv/home/workspaces')
  })

  it('re-resolves when the runtime environment becomes known after mount', async () => {
    // Web client: nothing can resolve before the paired environment exists ('' from the resolver).
    getFloatingTerminalCwd.mockResolvedValueOnce('').mockResolvedValueOnce('/srv/home/workspaces')
    render(makeInput({ runtimeEnvironmentKey: '' }))
    await flush()
    expect(setCwd).toHaveBeenLastCalledWith('')

    render(makeInput({ runtimeEnvironmentKey: 'env-1' }))
    await flush()

    expect(getFloatingTerminalCwd).toHaveBeenCalledTimes(2)
    expect(setCwd).toHaveBeenLastCalledWith('/srv/home/workspaces')
  })

  it('does not resolve again for a re-render with unchanged inputs', async () => {
    getFloatingTerminalCwd.mockResolvedValue('/srv/home/workspaces')
    render(makeInput({ runtimeEnvironmentKey: 'env-1' }))
    await flush()
    render(makeInput({ runtimeEnvironmentKey: 'env-1' }))
    await flush()

    expect(getFloatingTerminalCwd).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous directory and raises no unhandled rejection when the resolve fails', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      getFloatingTerminalCwd.mockRejectedValue(new Error('runtime unreachable'))
      render(makeInput())
      await flush()
      // Give the event loop a turn so a stray rejection would be reported.
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(setCwd).not.toHaveBeenCalled()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('discards a stale result when the inputs change before it arrives', async () => {
    let resolveStale: (value: string) => void = () => {}
    getFloatingTerminalCwd
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveStale = resolve
          })
      )
      .mockResolvedValueOnce('/srv/home/fresh')
    render(makeInput({ runtimeEnvironmentKey: '' }))
    render(makeInput({ runtimeEnvironmentKey: 'env-1' }))
    await flush()
    resolveStale('/srv/home/stale')
    await flush()

    expect(setCwd).toHaveBeenCalledWith('/srv/home/fresh')
    expect(setCwd).not.toHaveBeenCalledWith('/srv/home/stale')
  })
})
