import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import {
  floatingNotesFileAddress,
  floatingNotesRootSelector
} from './runtime-floating-notes-file-address'
import { getRemoteFileArgs } from './runtime-file-routing'

const NOTES = '/home/coder/.config/orca/floating-workspace'

describe('floating notes file address (aidev02 #325)', () => {
  it('addresses a floating note by the host notes folder', () => {
    expect(floatingNotesFileAddress(FLOATING_TERMINAL_WORKTREE_ID, `${NOTES}/untitled.md`)).toEqual(
      {
        root: NOTES,
        worktreeSelector: `path:${NOTES}`,
        relativePath: 'untitled.md'
      }
    )
    expect(
      floatingNotesFileAddress(FLOATING_TERMINAL_WORKTREE_ID, `${NOTES}/sub/note.md`)?.relativePath
    ).toBe('sub/note.md')
  })

  it('leaves other workspaces and files outside the notes folder alone', () => {
    expect(floatingNotesFileAddress('wt-1', `${NOTES}/untitled.md`)).toBeNull()
    expect(
      floatingNotesFileAddress(FLOATING_TERMINAL_WORKTREE_ID, '/home/coder/notes.md')
    ).toBeNull()
    expect(floatingNotesFileAddress(FLOATING_TERMINAL_WORKTREE_ID, NOTES)).toBeNull()
  })

  it('selects the notes folder for a floating workspace rooted there', () => {
    expect(floatingNotesRootSelector(FLOATING_TERMINAL_WORKTREE_ID, NOTES)).toBe(`path:${NOTES}`)
    expect(floatingNotesRootSelector(FLOATING_TERMINAL_WORKTREE_ID, '/home/coder')).toBeNull()
    expect(floatingNotesRootSelector('wt-1', NOTES)).toBeNull()
  })

  it('routes runtime file operations on a floating note to the notes folder', () => {
    const target = { kind: 'environment', environmentId: 'web-env' } as const
    expect(
      getRemoteFileArgs(
        { target, worktreeId: FLOATING_TERMINAL_WORKTREE_ID, worktreePath: NOTES },
        `${NOTES}/untitled.md`
      )
    ).toMatchObject({ worktreeSelector: `path:${NOTES}`, relativePath: 'untitled.md' })
    // A floating file outside the notes folder keeps upstream's sentinel address.
    expect(
      getRemoteFileArgs(
        { target, worktreeId: FLOATING_TERMINAL_WORKTREE_ID, worktreePath: '/home/coder' },
        '/home/coder/todo.md'
      )
    ).toMatchObject({
      worktreeSelector: `id:${FLOATING_TERMINAL_WORKTREE_ID}`,
      relativePath: 'todo.md'
    })
  })
})
