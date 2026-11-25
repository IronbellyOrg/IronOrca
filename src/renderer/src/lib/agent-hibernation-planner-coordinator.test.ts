import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import {
  DEFAULT_AGENT_HIBERNATION_IDLE_MS,
  planAgentHibernationCandidates,
  type AgentHibernationPlannerSnapshot
} from './agent-hibernation-planner'

const IDLE = DEFAULT_AGENT_HIBERNATION_IDLE_MS
const NOW = 2_000_000
const OLD = NOW - IDLE - 1
const COORDINATOR_LEAF = '11111111-1111-4111-8111-111111111111'
const WORKER_LEAF = '22222222-2222-4222-8222-222222222222'
const COORDINATOR_KEY = `tab-1:${COORDINATOR_LEAF}`
const WORKER_KEY = `tab-2:${WORKER_LEAF}`

function tab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: 'Agent',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function layout(leafId: string, ptyId: string): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null,
    ptyIdsByLeafId: { [leafId]: ptyId }
  }
}

function agent(overrides: Partial<AgentStatusEntry>): AgentStatusEntry {
  return {
    state: 'done',
    prompt: 'make it so',
    updatedAt: OLD,
    stateStartedAt: OLD,
    paneKey: COORDINATOR_KEY,
    tabId: 'tab-1',
    worktreeId: 'wt-bg',
    agentType: 'claude',
    providerSession: { key: 'session_id', id: 'session-1' },
    stateHistory: [],
    ...overrides
  }
}

const coordinator = agent({ terminalHandle: 'term-coordinator' })

// The worker lives in a tab of another worktree, so only the whole-record map can protect the coordinator.
function worker(
  orchestration: Partial<NonNullable<AgentStatusEntry['orchestration']>>,
  overrides: Partial<AgentStatusEntry> = {}
): AgentStatusEntry {
  return agent({
    paneKey: WORKER_KEY,
    tabId: 'tab-2',
    worktreeId: 'wt-other',
    orchestration: { taskId: 'task-1', dispatchId: 'ctx-1', ...orchestration },
    ...overrides
  })
}

function snapshot(
  entries: (AgentStatusEntry | undefined)[],
  now = NOW
): AgentHibernationPlannerSnapshot {
  const agentStatusByPaneKey: AgentHibernationPlannerSnapshot['agentStatusByPaneKey'] = {}
  for (const [index, entry] of entries.entries()) {
    agentStatusByPaneKey[entry?.paneKey ?? `tab-9:undefined-${index}`] = entry
  }
  return {
    settings: { experimentalAgentHibernation: true, agentHibernationIdleMs: IDLE },
    activeWorktreeId: 'wt-active',
    foregroundTerminalTabIds: [],
    tabsByWorktree: { 'wt-bg': [tab('tab-1', 'wt-bg')], 'wt-other': [tab('tab-2', 'wt-other')] },
    terminalLayoutsByTabId: {
      'tab-1': layout(COORDINATOR_LEAF, 'pty-1'),
      'tab-2': layout(WORKER_LEAF, 'pty-2')
    },
    ptyIdsByTabId: { 'tab-1': ['pty-1'], 'tab-2': ['pty-2'] },
    mobileLockedPtyIds: [],
    agentStatusByPaneKey,
    sleepingAgentSessionsByPaneKey: {},
    lastTerminalInputAtByPaneKey: {},
    foregroundTerminalLastSeenAtByTabId: {},
    now
  }
}

function plannedPaneKeys(input: AgentHibernationPlannerSnapshot): string[] {
  return planAgentHibernationCandidates(input).map((candidate) => candidate.paneKey)
}

describe('coordinator protection while a worker dispatch is open', () => {
  it('plans an idle coordinator that has no worker', () => {
    expect(plannedPaneKeys(snapshot([coordinator]))).toEqual([COORDINATOR_KEY])
  })

  it.each([undefined, 'pending', 'dispatched'] as const)(
    'keeps the coordinator awake while its worker in another worktree is %s',
    (dispatchStatus) => {
      const open = worker({
        parentPaneKey: COORDINATOR_KEY,
        ...(dispatchStatus ? { dispatchStatus } : {})
      })
      expect(plannedPaneKeys(snapshot([coordinator, open]))).not.toContain(COORDINATOR_KEY)
    }
  )

  it('keeps the coordinator awake when the worker names it only by terminal handle', () => {
    const open = worker({ parentTerminalHandle: 'term-coordinator', dispatchStatus: 'dispatched' })
    expect(plannedPaneKeys(snapshot([coordinator, open]))).not.toContain(COORDINATOR_KEY)
  })

  it('keeps the coordinator awake when the worker names its pane under an older tab id', () => {
    const open = worker({
      parentPaneKey: `older-tab:${COORDINATOR_LEAF}`,
      dispatchStatus: 'dispatched'
    })
    expect(plannedPaneKeys(snapshot([coordinator, open]))).not.toContain(COORDINATOR_KEY)
  })

  it.each(['completed', 'failed', 'circuit_broken'] as const)(
    'plans the coordinator one idle window after its last worker settled as %s',
    (dispatchStatus) => {
      const workerSettledAt = NOW - 1_000
      const settled = worker(
        { parentPaneKey: COORDINATOR_KEY, dispatchStatus },
        { stateStartedAt: workerSettledAt, updatedAt: workerSettledAt }
      )
      expect(
        plannedPaneKeys(snapshot([coordinator, settled], workerSettledAt + IDLE - 1))
      ).not.toContain(COORDINATOR_KEY)
      expect(plannedPaneKeys(snapshot([coordinator, settled], workerSettledAt + IDLE))).toContain(
        COORDINATOR_KEY
      )
    }
  )

  it('uses the coordinator own idle clock once the worker entries are gone', () => {
    const settled = worker(
      { parentPaneKey: COORDINATOR_KEY, dispatchStatus: 'completed' },
      { stateStartedAt: NOW - 1_000, updatedAt: NOW - 1_000 }
    )
    expect(plannedPaneKeys(snapshot([coordinator, settled]))).not.toContain(COORDINATOR_KEY)
    expect(plannedPaneKeys(snapshot([coordinator]))).toEqual([COORDINATOR_KEY])
  })

  it('ignores a worker that names a different parent', () => {
    const other = worker({
      parentPaneKey: `tab-9:${'33333333-3333-4333-8333-333333333333'}`,
      parentTerminalHandle: 'term-someone-else',
      dispatchStatus: 'pending'
    })
    expect(plannedPaneKeys(snapshot([coordinator, other]))).toContain(COORDINATOR_KEY)
  })

  it('skips undefined entries in the status record', () => {
    expect(plannedPaneKeys(snapshot([undefined, coordinator]))).toEqual([COORDINATOR_KEY])
  })

  it('keeps the existing rule for the worker own pane', () => {
    const settled = worker({ parentPaneKey: COORDINATOR_KEY, dispatchStatus: 'completed' })
    const open = worker({ parentPaneKey: COORDINATOR_KEY, dispatchStatus: 'dispatched' })
    expect(plannedPaneKeys(snapshot([settled]))).toEqual([WORKER_KEY])
    expect(plannedPaneKeys(snapshot([open]))).toEqual([])
  })
})
