import { beforeEach, describe, expect, it, vi } from 'vitest'

const callRuntimeEnvelope = vi.hoisted(() => vi.fn())
vi.mock('./web-runtime-calls', () => ({ callRuntimeEnvelope }))
import { createWebMobileApi } from './web-mobile-api'

describe('browser mobile API', () => {
  beforeEach(() => {
    callRuntimeEnvelope.mockReset()
  })

  it('uses the existing authenticated runtime path without fabricating NICs', async () => {
    const api = createWebMobileApi().mobile!
    expect(await api.listNetworkInterfaces()).toEqual({ interfaces: [] })
    expect(callRuntimeEnvelope).not.toHaveBeenCalled()
    callRuntimeEnvelope.mockResolvedValue({ ok: true, result: { endpoints: [] } })
    await api.listPairingEndpoints!()
    expect(callRuntimeEnvelope).toHaveBeenLastCalledWith('mobile.pairing.endpoints', undefined)
    const args = {
      address: 'https://owner.example.test/orca/',
      connectionMode: 'local-only' as const,
      rotate: true
    }
    callRuntimeEnvelope.mockResolvedValue({ ok: true, result: { available: true } })
    await api.getPairingQR(args)
    expect(callRuntimeEnvelope).toHaveBeenLastCalledWith('mobile.pairing.create', args)
    callRuntimeEnvelope.mockResolvedValue({
      ok: true,
      result: {
        devices: [
          { deviceId: 'pending', lastSeenAt: 0 },
          { deviceId: 'paired', lastSeenAt: 1 }
        ]
      }
    })
    expect(await api.listDevices()).toEqual({
      devices: [
        { deviceId: 'pending', lastSeenAt: 0 },
        { deviceId: 'paired', lastSeenAt: 1 }
      ]
    })
    expect(callRuntimeEnvelope).toHaveBeenLastCalledWith('mobile.pairing.list', undefined)
    await api.revokeDevice({ deviceId: 'pending' })
    expect(callRuntimeEnvelope).toHaveBeenLastCalledWith('mobile.pairing.revoke', {
      deviceId: 'pending'
    })
  })

  it.each([
    'forbidden',
    'unauthorized',
    'owner_route_unavailable',
    'invalid_advertised_endpoint',
    'unsupported_connection_mode',
    'unknown_method',
    'relay_pending_conflict'
  ])('returns safe actionable %s errors instead of raw transport content', async (code) => {
    callRuntimeEnvelope.mockResolvedValue({ ok: false, error: { code, message: 'SECRET_CANARY' } })
    const result = await createWebMobileApi().mobile!.getPairingQR({ connectionMode: 'local-only' })
    expect(result.available).toBe(false)
    expect(!result.available && result.reason).toBe(code)
    expect(JSON.stringify(result).includes('SECRET_CANARY')).toBe(false)
  })

  it('does not report an unavailable runtime as an empty device list', async () => {
    callRuntimeEnvelope.mockRejectedValue(new Error('SECRET_CANARY'))
    const api = createWebMobileApi().mobile!
    const result = await api.getPairingQR()
    expect(!result.available && result.reason).toBe('runtime_unavailable')
    expect(JSON.stringify(result).includes('SECRET_CANARY')).toBe(false)
    await expect(api.listDevices()).rejects.toThrow('Reconnect to the Orca runtime')
  })
})
