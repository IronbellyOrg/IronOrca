import { toast } from 'sonner'
import { browseRuntimeServerDirectory } from '../../runtime/runtime-server-directory-browser'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import { requireActiveEnvironmentOrNull } from './web-runtime-session'

const reportedFailures = new Set<string>()

// Why once per page per kind: the resolver is shared by the floating panel, the Settings pane and
// the onboarding terminal, and the first two re-resolve on every mount.
function reportOnce(kind: string, message: string): void {
  if (reportedFailures.has(kind)) {
    return
  }
  reportedFailures.add(kind)
  try {
    toast.error(message, { id: `web-floating-workspace-${kind}` })
  } catch {
    // A toast must never break directory resolution.
  }
}

/**
 * The directory a web floating terminal starts in, resolved on the runtime SERVER (its `~`, its
 * filesystem), never the browser machine's. Never rejects.
 *
 * - environment known, directory resolves  -> the server's absolute path
 * - environment known, directory missing   -> the server home, plus one toast
 * - environment known, server unreachable  -> the configured string (the server expands it, and
 *   falls back to its home, when the terminal is created), plus one toast
 * - no environment yet                     -> '' silently: nothing can launch, and the panel
 *   re-resolves once an environment is known
 */
export async function resolveWebFloatingTerminalCwd(path: string | undefined): Promise<string> {
  const requested = path?.trim() || '~'
  try {
    const environment = requireActiveEnvironmentOrNull()
    if (!environment) {
      return ''
    }
    try {
      return (await browseRuntimeServerDirectory(environment.id, requested)).resolvedPath
    } catch {
      if (requested !== '~') {
        try {
          const home = await browseRuntimeServerDirectory(environment.id, '~')
          reportOnce(
            'directory-missing',
            `The floating workspace directory ${requested} is not available on the Orca server. Starting in the server home instead.`
          )
          return home.resolvedPath
        } catch {
          // The server itself did not answer: handled below.
        }
      }
      reportOnce(
        'server-unreachable',
        'Could not reach the Orca server to resolve the floating workspace directory.'
      )
      return requested
    }
  } catch {
    return ''
  }
}

/**
 * The directory web floating markdown notes live in: the runtime SERVER's app-owned floating
 * workspace directory (the same one desktop uses). '' when no environment is paired yet or the
 * server does not answer; the create action reports that instead of failing silently.
 */
export async function resolveWebFloatingMarkdownDirectory(): Promise<string> {
  try {
    const environment = requireActiveEnvironmentOrNull()
    if (!environment) {
      return ''
    }
    const result = await callRuntimeRpc<{ path: string }>(
      { kind: 'environment', environmentId: environment.id },
      'files.floatingMarkdownDirectory',
      {},
      { timeoutMs: 15_000 }
    )
    return typeof result?.path === 'string' ? result.path : ''
  } catch {
    return ''
  }
}
