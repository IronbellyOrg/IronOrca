import type { GlobalSettings } from './global-settings-types'

// aidev02 fork difference: upstream v1.4.251+ defaults this to 4 with nestedWorkerMaxDepthDefaultedToFour.
// On the next upstream merge keep 2 and this guard name, or drop the fork change if 4 is accepted.
/** Worker nesting limit: at two, a coordinator's worker can dispatch one more level and no deeper. */
export const NESTED_WORKER_MAX_DEPTH_DEFAULT = 2

/** The pre-2 default, persisted in full so it cannot be told apart from a deliberate choice. */
const LEGACY_NESTED_WORKER_MAX_DEPTH_DEFAULT = 1

/** Root coordinators are depth 0; the first generation of workers is depth 1. */
export const ROOT_DISPATCH_DEPTH = 0

export const NESTED_WORKER_DEPTH_EXCEEDED_CODE = 'nested_worker_depth_exceeded'

export function nestedWorkerDepthExceededMessage(childDepth: number, maxDepth: number): string {
  // Explicitly require doing the work locally or refused workers loop on unavailable dispatch.
  return (
    `Sub-worker dispatch is not permitted at depth ${childDepth} (max ${maxDepth}). ` +
    'Complete this task yourself.'
  )
}

export const NESTED_WORKER_DEPTH_EXCEEDED_NEXT_STEPS: readonly string[] = [
  'Do the work in this terminal instead of dispatching a sub-worker.',
  'To allow deeper nesting, open Settings → Orchestration in the Orca desktop app and raise "Nested worker depth".'
]

/** Reject unsafe/noninteger values below one to the default; malformed settings cannot disable the depth fence. */
export function resolveNestedWorkerMaxDepth(
  settings: Pick<GlobalSettings, 'nestedWorkerMaxDepth'> | null | undefined
): number {
  const raw = settings?.nestedWorkerMaxDepth
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) {
    return NESTED_WORKER_MAX_DEPTH_DEFAULT
  }
  return raw
}

/** Move the old default of 1 to 2 once; higher values and any value written after the guard stay. */
export function migrateNestedWorkerMaxDepthDefault(
  settings:
    | Pick<GlobalSettings, 'nestedWorkerMaxDepth' | 'nestedWorkerMaxDepthDefaultedToTwo'>
    | undefined
): Required<Pick<GlobalSettings, 'nestedWorkerMaxDepth' | 'nestedWorkerMaxDepthDefaultedToTwo'>> {
  const current = resolveNestedWorkerMaxDepth(settings)
  return {
    nestedWorkerMaxDepth:
      settings?.nestedWorkerMaxDepthDefaultedToTwo !== true &&
      current === LEGACY_NESTED_WORKER_MAX_DEPTH_DEFAULT
        ? NESTED_WORKER_MAX_DEPTH_DEFAULT
        : current,
    nestedWorkerMaxDepthDefaultedToTwo: true
  }
}
