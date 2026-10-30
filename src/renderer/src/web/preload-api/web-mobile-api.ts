import type { PreloadApi } from '../../../../preload/api-types'
import type { MobileApi } from '../../../../preload/api/mobile-api'
import { callRuntimeEnvelope } from './web-runtime-calls'
import { noopUnsubscribe } from './web-storage'

// Only fixed messages cross into UI errors: transport exceptions can contain URLs/tokens.
async function mobileCall<T>(method: string, params?: unknown): Promise<T> {
  let response
  try {
    response = await callRuntimeEnvelope<T>(method, params)
  } catch {
    throw Object.assign(new Error('Reconnect to the Orca runtime and try again.'), {
      code: 'runtime_unavailable'
    })
  }
  if (!response.ok) {
    const messages: Record<string, string> = {
      unauthorized: 'Runtime authorization expired. Reconnect before pairing.',
      forbidden: 'Mobile pairing management requires runtime access.',
      method_not_found: 'This runtime does not support browser mobile pairing. Update the runtime.',
      unknown_method: 'This runtime does not support browser mobile pairing. Update the runtime.',
      owner_route_unavailable: 'A secure owner route is not configured for mobile pairing.',
      native_route_unavailable:
        'The native tailnet route is unavailable. Ordinary browser access is unchanged.',
      unsupported_connection_mode: 'Choose LAN to pair through the configured route.',
      invalid_advertised_endpoint:
        'Use only the configured route, without credentials, query parameters or fragments.',
      invalid_params: 'Invalid mobile pairing request.',
      relay_pending_conflict: 'Revoke the pending Relay pairing before generating a new code.',
      pairing_request_superseded: 'The code was replaced or revoked. Generate a new code.',
      device_registry_unavailable: 'The pairing registry is unavailable.'
    }
    const code = Object.hasOwn(messages, response.error.code)
      ? response.error.code
      : 'runtime_unavailable'
    throw Object.assign(
      new Error(messages[code] ?? 'Mobile pairing is unavailable. Reconnect and retry.'),
      { code }
    )
  }
  return response.result
}

export function createWebMobileApi(): Partial<PreloadApi> {
  return {
    mobile: {
      // Browsers cannot discover the host NICs. Offer the server's configured route separately.
      listNetworkInterfaces: () => Promise.resolve({ interfaces: [] }),
      listPairingEndpoints: () => mobileCall('mobile.pairing.endpoints'),
      getPairingQR: async (args) => {
        try {
          return await mobileCall<Awaited<ReturnType<MobileApi['getPairingQR']>>>(
            'mobile.pairing.create',
            args
          )
        } catch (error) {
          const safe = error as Error & { code: string }
          return { available: false, reason: safe.code, guidance: safe.message }
        }
      },
      getWindowsFirewallStatus: () => Promise.resolve({ supported: false }),
      repairWindowsFirewall: () => Promise.resolve({ ok: false, reason: 'unsupported' }),
      openWindowsNetworkSettings: () => Promise.resolve(false),
      getRuntimePairingUrl: () => Promise.resolve({ available: false }),
      listDevices: () => mobileCall('mobile.pairing.list'),
      revokeDevice: (args) => mobileCall('mobile.pairing.revoke', args),
      listRuntimeAccessGrants: () => Promise.resolve({ grants: [] }),
      revokeRuntimeAccess: () => Promise.resolve({ revoked: false }),
      getRelayStatus: () => Promise.resolve({ status: 'offline' as const }),
      onRelayStatusChanged: () => noopUnsubscribe,
      consumePendingUnpairedDeviceAuthFailure: () => Promise.resolve(false),
      onUnpairedDeviceAuthFailure: () => noopUnsubscribe
    }
  }
}
