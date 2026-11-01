import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import { isNativeChatDefaultFor } from '../../shared/structured-native-chat-launch-route'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { STRUCTURED_AGENT_RUNTIME_METADATA } from './structured-agent-runtime-metadata'

// aidev02: Chat UI stays on, but every new agent tab opens in the terminal, as the retired
// openAgentTabsInChatByDefault=false did. Upstream routes any unchosen agent with a structured
// session to chat, so each one this build can run as chat needs an explicit terminal default.
// A new structured agent upstream fails here until the port decides its default.
describe('aidev02 native chat defaults', () => {
  it('opens every structured agent in the terminal on a fresh profile', () => {
    const settings = getDefaultSettings('/home/coder')
    const agents = STRUCTURED_AGENT_RUNTIME_METADATA.map(({ definition }) => definition.agent)
    expect(agents.length).toBeGreaterThan(0)
    expect(settings.experimentalNativeChat).toBe(true)
    // Every structured agent is a choosable agent, so the check below covers all of them.
    expect(agents.filter((agent) => !isTuiAgent(agent))).toEqual([])
    expect(
      agents.filter(isTuiAgent).filter((agent) => isNativeChatDefaultFor(settings, agent))
    ).toEqual([])
  })
})
