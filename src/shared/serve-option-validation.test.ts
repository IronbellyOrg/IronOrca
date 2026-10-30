import { describe, expect, it } from 'vitest'
import { getServeFlagTypoError, getServeOptionValidationError } from './serve-option-validation'

const validOptions = {
  noPairing: false,
  mobilePairing: false,
  recipeJson: false,
  projectRoot: null
}

describe('getServeOptionValidationError', () => {
  it.each(['127.0.0.1', '::1', '0.0.0.0', '2001:db8::1'])('accepts literal bind %s', (bindHost) => {
    expect(getServeOptionValidationError({ ...validOptions, bindHost })).toBeNull()
  })

  it.each(['', ' ', 'localhost', 'https://127.0.0.1', '127.0.0.1:6768', '[::1]', '999.0.0.1'])(
    'rejects nonliteral bind %j',
    (bindHost) => {
      expect(getServeOptionValidationError({ ...validOptions, bindHost })).toMatch(/Invalid --bind/)
    }
  )
})

describe('getServeFlagTypoError', () => {
  it('accepts exact serve flags and arbitrary Chromium switches', () => {
    expect(
      getServeFlagTypoError([
        '/opt/orca/orca-ide',
        '--serve',
        '--serve-no-pairing',
        '--disable-gpu',
        '--disable-features=Vulkan',
        '--no-parent'
      ])
    ).toBeNull()
  })

  it.each(['--no-pair', '--no-pairng', '--no-paring', '--mobile-pairng'])(
    'suggests the intended pairing flag for %s',
    (flag) => {
      expect(getServeFlagTypoError(['/opt/orca/orca-ide', '--serve', flag])).toMatch(
        /Unknown flag .*Did you mean --(?:no-pairing|mobile-pairing)\?/i
      )
    }
  )

  it.each(['--bind', '--serve-bind'])('accepts exact %s and skips its value', (flag) => {
    expect(getServeFlagTypoError([flag, '127.0.0.1'])).toBeNull()
    expect(getServeFlagTypoError([`${flag}=::1`])).toBeNull()
  })

  it.each(['--bnd', '--bindd', '--serve-bnd', '--serve-bindd'])('rejects bind typo %s', (flag) => {
    expect(getServeFlagTypoError([flag, '127.0.0.1'])).toMatch(/Unknown flag .*--(?:serve-)?bind/)
  })

  it('does not reinterpret tokens after --', () => {
    expect(getServeFlagTypoError(['/opt/orca/orca-ide', '--serve', '--', '--no-pairng'])).toBeNull()
  })

  it('does not inspect an equals-form value as a flag', () => {
    expect(
      getServeFlagTypoError(['/opt/orca/orca-ide', '--serve-pairing-address=--no-pairng'])
    ).toBeNull()
  })

  it('keeps flag-shaped space values subject to typo validation', () => {
    expect(
      getServeFlagTypoError(['/opt/orca/orca-ide', '--serve-pairing-address', '--no-pairng'])
    ).toMatch(/Unknown flag --no-pairng.*--no-pairing/i)
  })
})
