// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'

const hoisted = vi.hoisted(() => ({ web: false }))

vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => hoisted.web }))
vi.mock('../../store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ settingsSearchQuery: '' }),
    { getState: () => ({ recordFeatureInteraction: vi.fn() }) }
  )
}))

import {
  FloatingWorkspacePane,
  getFloatingWorkspaceDirectoryInputValue
} from './FloatingWorkspacePane'

const PICKER_LABEL = 'Choose floating workspace directory'

function renderPane(): string {
  return renderToStaticMarkup(
    <FloatingWorkspacePane
      settings={{ ...getDefaultSettings('~'), floatingTerminalCwd: '~/workspaces' }}
      updateSettings={vi.fn()}
    />
  )
}

function pickerButton(markup: string): string {
  const match = markup.match(new RegExp(`<button[^>]*aria-label="${PICKER_LABEL}"[^>]*>`))
  if (!match) {
    throw new Error('directory picker button not rendered')
  }
  return match[0]
}

describe('FloatingWorkspacePane directory picker', () => {
  beforeEach(() => {
    hoisted.web = false
  })

  it('disables the picker in the web client, where picking is not implemented, and says why', () => {
    hoisted.web = true
    const button = pickerButton(renderPane())
    expect(button).toContain('disabled=""')
    expect(button).toContain('title="Choosing a different directory is not available')
  })

  it('keeps the picker enabled everywhere else', () => {
    hoisted.web = false
    const button = pickerButton(renderPane())
    // Match the attribute, not the word: the button's class list contains "disabled:" variants.
    expect(button).not.toContain('disabled=""')
    expect(button).not.toContain(' title=')
  })

  it('still shows the directory field read-only in the web client', () => {
    hoisted.web = true
    const markup = renderPane()
    expect(markup).toMatch(/<input[^>]*readOnly=""/)
  })

  it('shows the web default as the resolved SERVER path, not the ~/workspaces shorthand', () => {
    // The pane asks getFloatingTerminalCwd (the web resolver) for the path and shows its answer.
    expect(
      getFloatingWorkspaceDirectoryInputValue({
        configuredFloatingWorkspacePath: '~/workspaces',
        resolvedFloatingWorkspacePath: '/home/coder/workspaces'
      })
    ).toBe('/home/coder/workspaces')
  })
})
