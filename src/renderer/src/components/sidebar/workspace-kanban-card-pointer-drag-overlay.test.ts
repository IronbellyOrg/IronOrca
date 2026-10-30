import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDropTarget } from './workspace-kanban-card-pointer-drag-dom'

// aidev02: with the new card style, a workspace hover card portaled outside the board can sit over
// the lane a card is dragged to; the drop must still land in that lane.

function selfAndAncestors(start: FakeElement): FakeElement[] {
  const chain: FakeElement[] = []
  for (let node: FakeElement | null = start; node; node = node.parent) {
    chain.push(node)
  }
  return chain
}

class FakeElement {
  readonly dataset: Record<string, string> = {}
  constructor(
    readonly parent: FakeElement | null,
    readonly attributes: readonly string[] = []
  ) {}

  closest(selector: string): FakeElement | null {
    const attribute = selector.slice(1, -1)
    return selfAndAncestors(this).find((node) => node.attributes.includes(attribute)) ?? null
  }

  contains(other: FakeElement): boolean {
    return selfAndAncestors(other).includes(this)
  }

  querySelectorAll(): FakeElement[] {
    return []
  }
}

function boardWithLane(): { board: FakeElement; lane: FakeElement; overlay: FakeElement } {
  const board = new FakeElement(null)
  const lane = new FakeElement(board, ['data-workspace-status-drop-target'])
  lane.dataset.workspaceStatus = 'state-21'
  const overlay = new FakeElement(null)
  return { board, lane, overlay }
}

function stubDocument(atPoint: readonly FakeElement[]): void {
  vi.stubGlobal('document', {
    elementFromPoint: () => atPoint[0] ?? null,
    elementsFromPoint: () => [...atPoint]
  })
}

beforeEach(() => {
  vi.stubGlobal('Element', FakeElement)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspace kanban drop target under a floating overlay', () => {
  it('drops into the lane beneath a hover card portaled outside the board', () => {
    const { board, lane, overlay } = boardWithLane()
    stubDocument([overlay, lane, board])

    expect(getDropTarget(board as never, 100, 80)).toEqual({ status: 'state-21', isPinDrop: false })
  })

  it('still drops nowhere when nothing at the point belongs to the board', () => {
    const { board, overlay } = boardWithLane()
    stubDocument([overlay])

    expect(getDropTarget(board as never, 100, 80)).toEqual({ status: null, isPinDrop: false })
  })
})
