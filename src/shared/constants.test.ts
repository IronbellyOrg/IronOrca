import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'

describe('getDefaultSettings', () => {
  it('uses platform-consistent separators for the default workspace directory', () => {
    expect(getDefaultSettings('/Users/alice').workspaceDir).toBe(
      '/Users/alice/workspaces/worktrees'
    )
    expect(getDefaultSettings('C:\\Users\\alice').workspaceDir).toBe(
      'C:\\Users\\alice\\workspaces\\worktrees'
    )
  })

  it('enables the agent dashboard by default in its in-window mode', () => {
    expect(getDefaultSettings('/tmp').experimentalAgentDashboardPopout).toBe(true)
    expect(getDefaultSettings('/tmp').experimentalAgentDashboardMode).toBeUndefined()
    expect(getDefaultSettings('/tmp').experimentalAgentDashboardShowIdle).toBeUndefined()
  })

  it('applies the AIDev02 new-install defaults', () => {
    const settings = getDefaultSettings('/tmp')
    expect(settings).toMatchObject({
      editorAutoSave: true,
      diffDefaultView: 'side-by-side',
      editorMinimapEnabled: true,
      terminalRightClickToPaste: true,
      terminalClipboardOnSelect: true,
      terminalScrollbackRows: 25_000,
      experimentalAgentDashboardPopout: true,
      experimentalNativeChat: true,
      experimentalTerminalAttention: true,
      experimentalNewWorktreeCardStyle: true,
      // New agent tabs still open in the terminal while Chat UI is on (upstream #22933 retired
      // openAgentTabsInChatByDefault; the per-agent choices carry the same result).
      nativeChatProviders: {
        claude: false,
        codex: false,
        pi: false,
        grok: false,
        opencode: false,
        opencode2: false,
        omp: false,
        antigravity: false
      },
      // Unchanged: the web client keeps the floating workspace off on its own.
      floatingTerminalEnabled: true,
      floatingTerminalCwd: '~',
      // Agents pane: tab titles on, Auggie ('aug') disabled for new installs.
      tabAutoGenerateTitle: true,
      disabledTuiAgents: ['aug']
    })
    expect(settings.experimentalAgentDashboardMode).toBeUndefined()
    expect(settings.workspaceDir).toMatch(/workspaces[\\/]worktrees$/)
  })
})
