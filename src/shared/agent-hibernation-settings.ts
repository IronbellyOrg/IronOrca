import type { GlobalSettings } from './global-settings-types'

type AgentHibernationDefaultOnSettings = Pick<
  GlobalSettings,
  'experimentalAgentHibernation' | 'agentHibernationDefaultedOn'
>

export function normalizeAgentHibernationDefaultOn(
  settings: Partial<AgentHibernationDefaultOnSettings> | undefined
): Required<AgentHibernationDefaultOnSettings> {
  return {
    // Why: before the default-on rollout a saved false was the old default, not an opt-out; once the
    // marker is set a false is the user's choice and sticks. A saved true without the marker stays on.
    experimentalAgentHibernation:
      settings?.agentHibernationDefaultedOn === true
        ? settings.experimentalAgentHibernation !== false
        : true,
    agentHibernationDefaultedOn: true
  }
}
