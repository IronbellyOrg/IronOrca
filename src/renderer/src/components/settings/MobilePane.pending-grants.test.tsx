// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { act } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetPairedMobileDevicesCacheForTests,
  type PairedMobileDevice
} from '../mobile/paired-mobile-devices'

// aidev02: a grant a phone has not yet used (lastSeenAt 0) stays listed for revoke, but the QR's
// "a phone connected" polling counts only devices that have connected. Kept apart from
// MobilePane.test.tsx, which sits at the max-lines budget.

type PairedDevicesProps = {
  devices: readonly PairedMobileDevice[]
  onRevokeDevice: (deviceId: string) => void
}

const mocks = vi.hoisted(() => {
  const state = {
    orcaProfileAuthStatus: { state: 'connected' as const },
    settingsSearchQuery: '',
    settings: { mobileAutoRestoreFitMs: null },
    updateSettings: vi.fn(),
    recordFeatureInteraction: vi.fn(),
    fetchOrcaProfileAuthStatus: vi.fn()
  }
  const useAppStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state
  })
  return {
    state,
    useAppStore,
    latestPairedDevicesProps: null as PairedDevicesProps | null,
    getPairingQR: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: mocks.useAppStore }))
vi.mock('../../store', () => ({ useAppStore: mocks.useAppStore }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('./mobile-pairing-device-polling', () => ({ useMobilePairingDevicePolling: vi.fn() }))
vi.mock('./MobilePairingSetupSection', () => ({
  MobilePairingSetupSection: (props: { loading: boolean; onGenerateQr: () => void }) => (
    <button type="button" onClick={props.onGenerateQr} disabled={props.loading}>
      Generate
    </button>
  )
}))
vi.mock('./MobilePairingConnectionOptions', () => ({ MobilePairingConnectionOptions: () => null }))
vi.mock('./MobilePairingQrSection', () => ({
  MobilePairingQrSection: (props: { qrDataUrl: string | null }) => (
    <span data-testid="qr">{props.qrDataUrl ?? 'none'}</span>
  )
}))
vi.mock('./MobilePairedDevicesSection', () => ({
  MobilePairedDevicesSection: (props: PairedDevicesProps) => {
    mocks.latestPairedDevicesProps = props
    return <div data-testid="paired-devices">{props.devices.map((d) => d.deviceId).join(',')}</div>
  }
}))
vi.mock('./MobileAutoRestoreFitSection', () => ({ MobileAutoRestoreFitSection: () => null }))
vi.mock('../mobile/WindowsFirewallNotice', () => ({ WindowsFirewallNotice: () => null }))

import { MobilePane } from './MobilePane'
import { useMobilePairingDevicePolling } from './mobile-pairing-device-polling'

describe('MobilePane pending pairing grants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetPairedMobileDevicesCacheForTests()
    mocks.latestPairedDevicesProps = null
    mocks.getPairingQR.mockResolvedValue({
      available: true,
      qrDataUrl: 'data:image/png;base64,qr',
      pairingUrl: 'orca://pair',
      endpoint: 'ws://host',
      connectionMode: 'automatic'
    })
    mocks.revokeDevice.mockResolvedValue({ revoked: true })
    mocks.state.updateSettings.mockResolvedValue(undefined)
    mocks.state.fetchOrcaProfileAuthStatus.mockResolvedValue(null)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mobile: {
          getPairingQR: mocks.getPairingQR,
          listDevices: mocks.listDevices,
          listNetworkInterfaces: vi.fn().mockResolvedValue({ interfaces: [] }),
          revokeDevice: mocks.revokeDevice
        },
        ui: { writeClipboardText: vi.fn().mockResolvedValue(undefined) }
      }
    })
  })

  afterEach(() => {
    cleanup()
    _resetPairedMobileDevicesCacheForTests()
    document.body.innerHTML = ''
  })

  it('shows pending grants for revoke while QR polling counts only connected devices', async () => {
    const pending = { deviceId: 'pending', name: 'Pending phone', pairedAt: 1, lastSeenAt: 0 }
    mocks.listDevices.mockResolvedValue({ devices: [pending] })
    render(<MobilePane />)
    await waitFor(() => expect(screen.getByTestId('paired-devices')).toHaveTextContent('pending'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(screen.getByTestId('qr')).toHaveTextContent('base64,qr'))
    expect(vi.mocked(useMobilePairingDevicePolling).mock.lastCall?.[0]).toMatchObject({
      deviceCountAtQr: 0,
      currentDeviceCount: 0
    })
    mocks.listDevices.mockResolvedValue({ devices: [] })
    await act(async () => {
      mocks.latestPairedDevicesProps?.onRevokeDevice('pending')
    })
    await waitFor(() => expect(mocks.revokeDevice).toHaveBeenCalledWith({ deviceId: 'pending' }))
    await waitFor(() => expect(screen.getByTestId('paired-devices')).toBeEmptyDOMElement())
  })
})
