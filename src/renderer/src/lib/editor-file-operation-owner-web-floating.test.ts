import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import {
  captureEditorFileOperationProvenance,
  getEditorFileOperationContext
} from './editor-file-operation-owner'
import { setWebFloatingRuntimeOwnerResolver } from './terminal-worktree-route'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'

const NOTES = '/srv/user-data/floating-workspace'

beforeEach(() => {
  useAppStore.setState({
    repos: [],
    worktreesByRepo: {},
    detectedWorktreesByRepo: {},
    settings: { activeRuntimeEnvironmentId: null } as never,
    sshConnectionStates: new Map(),
    sshStateByEnvironment: new Map(),
    runtimeEnvironments: [],
    runtimeEnvironmentCatalogHydrated: false,
    removedRuntimeEnvironmentIds: new Set(),
    openFiles: [],
    activeFileId: null
  })
})

afterEach(() => {
  setWebFloatingRuntimeOwnerResolver(null)
})

describe('web floating workspace file owner (#325)', () => {
  it('routes floating workspace files to the paired runtime on web', () => {
    setWebFloatingRuntimeOwnerResolver(() => 'web-env')
    const provenance = captureEditorFileOperationProvenance(
      useAppStore.getState(),
      FLOATING_TERMINAL_WORKTREE_ID,
      'web-env',
      true
    )
    expect(provenance.generation.route).toEqual({
      executionHostId: 'runtime:web-env',
      runtimeEnvironmentId: 'web-env'
    })
    const context = getEditorFileOperationContext(
      useAppStore.getState(),
      {
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        runtimeEnvironmentId: 'web-env',
        operationProvenance: provenance
      },
      NOTES
    )
    expect(context.target).toEqual({ kind: 'environment', environmentId: 'web-env' })
    expect(context.worktreePath).toBe(NOTES)
  })

  it('a null owner hint contradicts the paired owner (why the create paths no longer suppress it)', () => {
    setWebFloatingRuntimeOwnerResolver(() => 'web-env')
    expect(() =>
      captureEditorFileOperationProvenance(
        useAppStore.getState(),
        FLOATING_TERMINAL_WORKTREE_ID,
        null,
        true
      )
    ).toThrow()
  })

  it('keeps the paired owner on the opened note, so reads and saves go to the runtime', () => {
    setWebFloatingRuntimeOwnerResolver(() => 'web-env')
    useAppStore.getState().openFile(
      {
        filePath: `${NOTES}/untitled.md`,
        relativePath: 'untitled.md',
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        language: 'markdown',
        isUntitled: true,
        mode: 'edit',
        runtimeEnvironmentId: 'web-env'
      },
      { preview: false, suppressActiveRuntimeFallback: false }
    )
    const opened = useAppStore.getState().openFiles.find((f) => f.relativePath === 'untitled.md')
    expect(opened?.runtimeEnvironmentId).toBe('web-env')
    expect(opened?.operationProvenance?.generation.route.runtimeEnvironmentId).toBe('web-env')
    const context = getEditorFileOperationContext(useAppStore.getState(), opened!, NOTES)
    expect(context.target).toEqual({ kind: 'environment', environmentId: 'web-env' })
  })

  it('stays local on Electron', () => {
    const provenance = captureEditorFileOperationProvenance(
      useAppStore.getState(),
      FLOATING_TERMINAL_WORKTREE_ID,
      null,
      true
    )
    expect(provenance.generation.route).toEqual({
      executionHostId: 'local',
      runtimeEnvironmentId: null
    })
  })
})
