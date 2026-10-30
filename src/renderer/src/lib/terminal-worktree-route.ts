import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { isEphemeralSetupTerminalWorktreeId } from '../../../shared/ephemeral-setup-terminal-worktree-id'
import { parseExecutionHostId } from '../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import type { AppState } from '@/store/types'
import { resolveOwnerOrLocal } from './worktree-runtime-owner'
import { namedHostForOwnerRef, runtimeEnvironmentIdUnlessTwin } from './resolve-owner'
import type { WorktreeRuntimeOwnerState } from './worktree-runtime-owner-state'
import {
  resolveWorktreeOperationRouteResultForHost,
  resolveWorktreeOperationRouteResult,
  type WorktreeOperationRouteResolution
} from './worktree-operation-route'
import { getSingleFocusedRuntimeEnvironmentId } from './single-runtime-legacy-owner'
import {
  hasIndexedDetectedWorktree,
  resolveIndexedRepoOwner,
  resolveIndexedWorktreeOwner
} from './worktree-runtime-owner-index'

export type TerminalWorktreeRoute = {
  runtimeEnvironmentId: string | null
}

/** Share terminal-surface routability for spawn and teardown; fixing only one strands PTYs (#9994/STA-2639). */
export type TerminalHostOwnership =
  | { kind: 'local-or-ssh'; runtimeEnvironmentId: null }
  | { kind: 'runtime'; runtimeEnvironmentId: string }
  | { kind: 'unresolved'; runtimeEnvironmentId: null }

/** Spawn can choose focused runtime for setup; teardown must identify the provider that actually owns the existing PTY. */
export type TerminalHostOwnershipPurpose = 'spawn' | 'teardown'

const UNRESOLVED_TERMINAL_HOST: TerminalHostOwnership = {
  kind: 'unresolved',
  runtimeEnvironmentId: null
}
const LOCAL_OR_SSH_TERMINAL_HOST: TerminalHostOwnership = {
  kind: 'local-or-ssh',
  runtimeEnvironmentId: null
}

function ownershipForRuntimeEnvironmentId(
  runtimeEnvironmentId: string | null
): TerminalHostOwnership {
  return runtimeEnvironmentId
    ? { kind: 'runtime', runtimeEnvironmentId }
    : LOCAL_OR_SSH_TERMINAL_HOST
}

let webFloatingRuntimeOwnerResolver: (() => string | null) | null = null

/**
 * The web client has no local PTYs, so its floating terminal can only run on the paired runtime.
 * That environment lives in the web client's own state, not in settings (its active-environment
 * preference stays null after pairing) and not in the store's runtimeEnvironments slice (filled
 * asynchronously, possibly after the pane connects). Web preload registers a synchronous reader
 * here; Electron never does, so its floating terminal stays local.
 */
export function setWebFloatingRuntimeOwnerResolver(resolver: (() => string | null) | null): void {
  webFloatingRuntimeOwnerResolver = resolver
}

/** The paired runtime that owns web floating-workspace files and terminals; null on Electron. */
export function getWebFloatingRuntimeOwner(): string | null {
  return webFloatingRuntimeOwnerResolver ? webFloatingRuntimeOwnerResolver() : null
}

export function resolveTerminalHostOwnership(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string | null | undefined,
  purpose: TerminalHostOwnershipPurpose
): TerminalHostOwnership {
  if (!worktreeId) {
    // Why: a tab with no owning row proves nothing about its host, so teardown cannot claim its PTY.
    return purpose === 'teardown' ? UNRESOLVED_TERMINAL_HOST : LOCAL_OR_SSH_TERMINAL_HOST
  }
  if (
    worktreeId === FLOATING_TERMINAL_WORKTREE_ID ||
    parseWorkspaceKey(worktreeId)?.type === 'folder'
  ) {
    const owner = resolveOwnerOrLocal(state, { workspaceId: worktreeId })
    if (owner.kind !== 'resolved') {
      // Spawn must refuse twins; their runtime PTYs use remote: IDs, so unqualified IDs remain local/SSH.
      return purpose === 'spawn' ? UNRESOLVED_TERMINAL_HOST : LOCAL_OR_SSH_TERMINAL_HOST
    }
    const { endpoint } = owner.owner
    return resolveFloatingScopeOwnership(
      state,
      worktreeId,
      purpose,
      endpoint.kind === 'environment' ? endpoint.environmentId : null
    )
  }
  // Setup/onboarding surfaces lack worktree rows; use focused runtime for installs there, else local, rather than strict unresolved-worktree refusal.
  if (isEphemeralSetupTerminalWorktreeId(worktreeId)) {
    return resolveFloatingScopeOwnership(
      state,
      worktreeId,
      purpose,
      getSingleFocusedRuntimeEnvironmentId(state)
    )
  }
  const resolution = resolveGitWorktreeRoute(state, worktreeId)
  if (resolution.kind === 'resolved') {
    if (resolution.route.runtimeEnvironmentId) {
      // Real worktrees retain runtime ownership on teardown: HUB wake hints use ssh: rather than remote:, so local fallback would kill/strand the wrong PTY (#9994).
      return { kind: 'runtime', runtimeEnvironmentId: resolution.route.runtimeEnvironmentId }
    }
    const parsed = parseExecutionHostId(resolution.route.executionHostId)
    return parsed?.kind === 'local' || parsed?.kind === 'ssh'
      ? LOCAL_OR_SSH_TERMINAL_HOST
      : UNRESOLVED_TERMINAL_HOST
  }
  return UNRESOLVED_TERMINAL_HOST
}

/** A named host takes the strict route, so rival servers for one `ssh:` target never read as direct. */
function resolveGitWorktreeRoute(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string
): WorktreeOperationRouteResolution {
  const hostId = namedHostForOwnerRef(state, { workspaceId: worktreeId })
  return hostId
    ? resolveWorktreeOperationRouteResultForHost(state, worktreeId, hostId)
    : resolveWorktreeOperationRouteResult(state, worktreeId)
}

export type TerminalPtyOwner =
  | { kind: 'runtime'; environmentId: string }
  | { kind: 'non-runtime' }
  | { kind: 'ambiguous' }

const NON_RUNTIME_PTY_OWNER: TerminalPtyOwner = { kind: 'non-runtime' }
const AMBIGUOUS_PTY_OWNER: TerminalPtyOwner = { kind: 'ambiguous' }

/** Resolve where spawn placed PTYs for teardown/identity. Contested/twin owners stay ambiguous; absent rows stay local. Unscoped remote: IDs use spawn routing, while raw setup IDs retain local teardown. */
export function resolveTerminalPtyOwner(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string | null | undefined,
  purpose: TerminalHostOwnershipPurpose = 'teardown'
): TerminalPtyOwner {
  if (!worktreeId) {
    return NON_RUNTIME_PTY_OWNER
  }
  const setup = isEphemeralSetupTerminalWorktreeId(worktreeId)
  if (
    !setup &&
    !namedHostForOwnerRef(state, { workspaceId: worktreeId }) &&
    isUnattributedTwinWorktree(state, worktreeId)
  ) {
    return AMBIGUOUS_PTY_OWNER
  }
  const ownership = resolveTerminalHostOwnership(state, worktreeId, setup ? purpose : 'spawn')
  switch (ownership.kind) {
    case 'runtime':
      return { kind: 'runtime', environmentId: ownership.runtimeEnvironmentId }
    case 'local-or-ssh':
      return NON_RUNTIME_PTY_OWNER
    case 'unresolved':
      return setup ||
        (parseWorkspaceKey(worktreeId)?.type !== 'folder' &&
          resolveGitWorktreeRoute(state, worktreeId).kind === 'missing')
        ? NON_RUNTIME_PTY_OWNER
        : AMBIGUOUS_PTY_OWNER
  }
}

/**
 * An unstamped worktree row with no detected copy, in a project two hosts publish: no row says
 * which host started its PTYs, so only each PTY's own `remote:<env>` id may.
 */
export function isUnattributedTwinWorktree(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string
): boolean {
  const worktree = resolveIndexedWorktreeOwner(state.worktreesByRepo, worktreeId)
  return (
    worktree.kind === 'resolved' &&
    !worktree.owner.runtimeOwnerEnvironmentId?.trim() &&
    !parseExecutionHostId(worktree.owner.hostId) &&
    !hasIndexedDetectedWorktree(state.detectedWorktreesByRepo, worktreeId) &&
    resolveIndexedRepoOwner(state.repos, worktree.owner.repoId).kind === 'ambiguous'
  )
}

/** Floating/folder/setup runtime PTYs use remote: IDs routed first, never ssh:-shaped HUB wake hints, so raw-ID teardown can safely downgrade ownership. */
function resolveFloatingScopeOwnership(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string,
  purpose: TerminalHostOwnershipPurpose,
  runtimeEnvironmentId: string | null
): TerminalHostOwnership {
  if (purpose === 'spawn' || !runtimeEnvironmentId) {
    return ownershipForRuntimeEnvironmentId(runtimeEnvironmentId)
  }
  // Why a twin downgrades too: runtime PTYs on these surfaces carry `remote:` ids, so a raw id is
  // local or SSH on either twin.
  if (runtimeEnvironmentIdUnlessTwin(state, worktreeId)) {
    return ownershipForRuntimeEnvironmentId(runtimeEnvironmentId)
  }
  // Focused-runtime/web-server guesses can flip during hydration without real owner evidence, stranding local PTYs (STA-2639).
  return LOCAL_OR_SSH_TERMINAL_HOST
}

export function resolveTerminalWorktreeRoute(
  state: AppState,
  worktreeId: string | null | undefined
): TerminalWorktreeRoute | null {
  const ownership = resolveTerminalHostOwnership(state, worktreeId, 'spawn')
  return ownership.kind === 'unresolved'
    ? null
    : { runtimeEnvironmentId: ownership.runtimeEnvironmentId }
}

/**
 * Route used when a pane CONNECTS its pty: resolveTerminalWorktreeRoute, except that in the web
 * client the floating terminal runs on the paired runtime.
 *
 * Why this is a separate function and not part of resolveTerminalHostOwnership: closing a tab,
 * bulk-closing, and tab creation all branch on the shared route and treat a runtime owner as a
 * host-mirrored session tab. The floating terminal is never host-mirrored (web-session-tabs-sync
 * excludes it), so changing the shared route would make closing a floating tab skip the remote
 * terminal.close and leak the shell. Only the transport choice needs the runtime here.
 */
export function resolveTerminalPaneSpawnRoute(
  state: AppState,
  worktreeId: string | null | undefined
): TerminalWorktreeRoute | null {
  if (worktreeId === FLOATING_TERMINAL_WORKTREE_ID && webFloatingRuntimeOwnerResolver) {
    const webOwner = webFloatingRuntimeOwnerResolver()
    if (webOwner) {
      return { runtimeEnvironmentId: webOwner }
    }
  }
  return resolveTerminalWorktreeRoute(state, worktreeId)
}

export function hasUnroutableTerminalWorktreeOwner(state: AppState, worktreeId: string): boolean {
  return resolveTerminalWorktreeRoute(state, worktreeId) === null
}
