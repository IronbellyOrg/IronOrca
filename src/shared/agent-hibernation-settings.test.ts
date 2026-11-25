import { describe, expect, it } from 'vitest'
import { normalizeAgentHibernationDefaultOn } from './agent-hibernation-settings'
import { getDefaultSettings } from './constants'

describe('normalizeAgentHibernationDefaultOn', () => {
  it('turns Agent sleep on and sets the marker when nothing is stored', () => {
    expect(normalizeAgentHibernationDefaultOn(undefined)).toEqual({
      experimentalAgentHibernation: true,
      agentHibernationDefaultedOn: true
    })
  })

  it('treats a saved false without the marker as the old default and converts it', () => {
    expect(normalizeAgentHibernationDefaultOn({ experimentalAgentHibernation: false })).toEqual({
      experimentalAgentHibernation: true,
      agentHibernationDefaultedOn: true
    })
  })

  it('keeps a saved true without the marker on and adds the marker', () => {
    expect(normalizeAgentHibernationDefaultOn({ experimentalAgentHibernation: true })).toEqual({
      experimentalAgentHibernation: true,
      agentHibernationDefaultedOn: true
    })
  })

  it('keeps a saved false once the marker is set', () => {
    expect(
      normalizeAgentHibernationDefaultOn({
        experimentalAgentHibernation: false,
        agentHibernationDefaultedOn: true
      })
    ).toEqual({ experimentalAgentHibernation: false, agentHibernationDefaultedOn: true })
  })

  it('keeps a saved true once the marker is set', () => {
    expect(
      normalizeAgentHibernationDefaultOn({
        experimentalAgentHibernation: true,
        agentHibernationDefaultedOn: true
      })
    ).toEqual({ experimentalAgentHibernation: true, agentHibernationDefaultedOn: true })
  })

  it('turns on when the marker is set but no toggle is stored', () => {
    expect(normalizeAgentHibernationDefaultOn({ agentHibernationDefaultedOn: true })).toEqual({
      experimentalAgentHibernation: true,
      agentHibernationDefaultedOn: true
    })
  })

  it('ships on with the marker already set and the 30 minute idle window', () => {
    const shipped = getDefaultSettings('/tmp')
    expect(shipped.experimentalAgentHibernation).toBe(true)
    expect(shipped.agentHibernationDefaultedOn).toBe(true)
    expect(shipped.agentHibernationIdleMs).toBe(30 * 60 * 1000)
  })
})
