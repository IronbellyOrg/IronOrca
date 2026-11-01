import { describe, expect, it, vi } from 'vitest'
import { browserMobilePairingRequest } from './runtime-rpc/runtime-rpc-browser-mobile-pairing'

// aidev02: phones another desktop delegated to this host belong to that desktop. Its next sync
// recreates any it lost, so this host neither lists them as its own nor reports a revoke.

const OWN = '11111111-1111-4111-8111-111111111111'
const PENDING = '22222222-2222-4222-8222-222222222222'
const DELEGATED = '33333333-3333-4333-8333-333333333333'
const own = { deviceId: OWN, name: 'Phone', scope: 'mobile', pairedAt: 1, lastSeenAt: 2 }
const pending = { deviceId: PENDING, name: 'Mobile', scope: 'mobile', pairedAt: 3, lastSeenAt: 0 }
const delegated = {
  deviceId: DELEGATED,
  name: 'Relayed phone',
  scope: 'mobile',
  pairedAt: 4,
  lastSeenAt: 5,
  parentDeviceId: 'other-desktop'
}
const devices = [own, pending, delegated, { ...own, deviceId: 'runtime', scope: 'runtime' }]

function fakeServer() {
  const revokeMobileDevice = vi.fn(async () => true)
  const server = {
    getDeviceRegistry: () => ({
      listDevices: () => devices,
      getDevice: (id: string) => devices.find((device) => device.deviceId === id) ?? null
    }),
    revokeMobileDevice
  }
  return { server: server as never, revokeMobileDevice }
}

describe('owner pairing management and delegated phones', () => {
  it('lists this host’s own phones and pending codes, not delegated ones', async () => {
    const { server } = fakeServer()
    const result = (await browserMobilePairingRequest(
      server,
      'https://coder.example.test/@u/w/apps/orca/',
      'mobile.pairing.list',
      {}
    )) as { devices: { deviceId: string }[] }
    expect(result.devices.map((device) => device.deviceId)).toEqual([OWN, PENDING])
  })

  it('refuses to revoke a delegated phone and still revokes an own one', async () => {
    const { server, revokeMobileDevice } = fakeServer()
    const route = 'https://coder.example.test/@u/w/apps/orca/'
    await expect(
      browserMobilePairingRequest(server, route, 'mobile.pairing.revoke', { deviceId: DELEGATED })
    ).rejects.toThrow('delegated_device')
    expect(revokeMobileDevice).not.toHaveBeenCalled()
    await expect(
      browserMobilePairingRequest(server, route, 'mobile.pairing.revoke', { deviceId: OWN })
    ).resolves.toEqual({ revoked: true })
    expect(revokeMobileDevice).toHaveBeenCalledWith(OWN)
  })
})
