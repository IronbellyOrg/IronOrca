import { describe, expect, it } from 'vitest'
import {
  NESTED_WORKER_MAX_DEPTH_DEFAULT,
  migrateNestedWorkerMaxDepthDefault,
  nestedWorkerDepthExceededMessage,
  resolveNestedWorkerMaxDepth
} from './nested-worker-depth'
import { getDefaultSettings } from './constants'

describe('resolveNestedWorkerMaxDepth', () => {
  it('defaults to 2 when unset', () => {
    expect(resolveNestedWorkerMaxDepth(undefined)).toBe(2)
    expect(resolveNestedWorkerMaxDepth(null)).toBe(2)
    expect(resolveNestedWorkerMaxDepth({})).toBe(2)
  })

  it('ships 2 with the migration guard already set', () => {
    const shipped = getDefaultSettings('/tmp')
    expect(shipped.nestedWorkerMaxDepth).toBe(2)
    expect(shipped.nestedWorkerMaxDepthDefaultedToTwo).toBe(true)
  })

  it('accepts whole numbers at or above 1', () => {
    expect(resolveNestedWorkerMaxDepth({ nestedWorkerMaxDepth: 1 })).toBe(1)
    expect(resolveNestedWorkerMaxDepth({ nestedWorkerMaxDepth: 3 })).toBe(3)
  })

  // Malformed settings must fall back to the cap, never disable nesting limits.
  it.each([
    ['a numeric string', '2'],
    ['a boolean', true],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['null', null]
  ])('falls back to the default for %s', (_label, value) => {
    expect(resolveNestedWorkerMaxDepth({ nestedWorkerMaxDepth: value as unknown as number })).toBe(
      NESTED_WORKER_MAX_DEPTH_DEFAULT
    )
  })
})

describe('migrateNestedWorkerMaxDepthDefault', () => {
  it('moves the old stored default of 1 to 2 once and sets the guard', () => {
    expect(migrateNestedWorkerMaxDepthDefault({ nestedWorkerMaxDepth: 1 })).toEqual({
      nestedWorkerMaxDepth: 2,
      nestedWorkerMaxDepthDefaultedToTwo: true
    })
  })

  it('keeps a value above 1 and a 1 chosen after the guard', () => {
    expect(
      migrateNestedWorkerMaxDepthDefault({ nestedWorkerMaxDepth: 3 }).nestedWorkerMaxDepth
    ).toBe(3)
    expect(
      migrateNestedWorkerMaxDepthDefault({
        nestedWorkerMaxDepth: 1,
        nestedWorkerMaxDepthDefaultedToTwo: true
      }).nestedWorkerMaxDepth
    ).toBe(1)
  })

  it('resolves a missing or malformed value to the default', () => {
    expect(migrateNestedWorkerMaxDepthDefault(undefined).nestedWorkerMaxDepth).toBe(2)
    expect(
      migrateNestedWorkerMaxDepthDefault({ nestedWorkerMaxDepth: Number.NaN }).nestedWorkerMaxDepth
    ).toBe(2)
  })
})

describe('depth-exceeded message', () => {
  it('names both depths and tells the worker to finish the task itself', () => {
    const message = nestedWorkerDepthExceededMessage(2, 1)
    expect(message).toContain('depth 2 (max 1)')
    expect(message).toContain('Complete this task yourself')
  })
})
