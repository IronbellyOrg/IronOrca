import { defineMethod } from '../core'
import { ensureDefaultFloatingWorkspacePath } from '../../../ipc/floating-workspace-directory'
import { FloatingMarkdownDirectory } from '../../../../shared/rpc-contract/files-params'

export const FILE_FLOATING_MARKDOWN_METHODS = [
  defineMethod({
    // Same app-owned directory desktop uses for floating notes; files.* calls address it with the
    // `path:<folder>` selector (floating-notes-file-root.ts), so the web client keeps notes there.
    name: 'files.floatingMarkdownDirectory',
    permission: 'workspace',
    params: FloatingMarkdownDirectory,
    handler: async () => ({ path: await ensureDefaultFloatingWorkspacePath() })
  })
] as const
