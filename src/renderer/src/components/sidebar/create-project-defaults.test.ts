import { describe, expect, it } from 'vitest'
import { getDefaultCreateProjectParent } from './create-project-defaults'

// aidev02: new projects default to ~/workspaces on every host.
describe('create project defaults', () => {
  it('builds the POSIX default project parent', () => {
    expect(getDefaultCreateProjectParent('/Users/alice')).toBe('/Users/alice/workspaces')
  })

  it('builds the Windows default project parent', () => {
    expect(getDefaultCreateProjectParent('C:\\Users\\alice')).toBe('C:\\Users\\alice\\workspaces')
  })

  it('derives the runtime project default from a resolved server home', () => {
    expect(getDefaultCreateProjectParent('/home/alice')).toBe('/home/alice/workspaces')
  })
})
