import { execFile } from 'node:child_process'
import { z } from 'zod'
import { normalizePairingUrl } from '../../../shared/network/pairing-url'
import { classifyRemotePairingHostname } from '../../../shared/remote-pairing-address'
import { encodeMobilePairingQr } from '../mobile-pairing-qr'
import type { RuntimeRpcPairing } from './runtime-rpc-pairing'

const CreateParams = z
  .object({
    address: z.string().max(2048).optional(),
    connectionMode: z.enum(['local-only', 'automatic']).optional(),
    rotate: z.boolean().optional()
  })
  .strict()
const RevokeParams = z.object({ deviceId: z.string().uuid() }).strict()
const EmptyParams = z.object({}).strict()

export const BROWSER_MOBILE_PAIRING_METHODS = new Set([
  'mobile.pairing.endpoints',
  'mobile.pairing.create',
  'mobile.pairing.list',
  'mobile.pairing.revoke'
])

export function browserMobilePairingEndpoint(address: string | undefined): string | null {
  if (!address || address.includes('?') || address.includes('#')) {
    return null
  }
  const normalized = normalizePairingUrl(address)
  if (!normalized) {
    return null
  }
  const url = new URL(normalized)
  if (url.protocol !== 'wss:' || classifyRemotePairingHostname(url.hostname) === 'loopback') {
    return null
  }
  return normalized
}

export async function nativeMobilePairingEndpoint(file: string): Promise<string | null> {
  const home = process.env.HOME
  if (!home?.startsWith('/') || file !== `${home}/.aidev-orca-tailnet/endpoint.json`) {
    throw new Error('native_route_unavailable')
  }
  // Fixed helper performs private-file, owner, live status and exact Serve checks on
  // every request. It never enrolls or starts a daemon here; no browser-selected path.
  return new Promise((resolve, reject) => {
    execFile(
      '/opt/aidev/orca/runtime.sh',
      ['tailnet', 'endpoint'],
      {
        env: { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin' },
        timeout: 18000,
        killSignal: 'SIGKILL',
        maxBuffer: 4096,
        encoding: 'utf8'
      },
      (error, stdout) => {
        const endpoint = stdout.trim()
        if (!error && endpoint === 'disabled') {
          resolve(null)
          return
        }
        if (error || !/^wss:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net\/$/.test(endpoint)) {
          reject(new Error('native_route_unavailable'))
          return
        }
        const normalized = browserMobilePairingEndpoint(endpoint)
        if (!normalized) {
          reject(new Error('native_route_unavailable'))
        } else {
          resolve(normalized)
        }
      }
    )
  })
}

// Called only after the WebSocket's runtime-scoped E2EE identity is authorized.
// Advertisement only: never call ensureNetworkExposure or replace ordinary grants.
export async function browserMobilePairingRequest(
  server: RuntimeRpcPairing,
  configuredAddress: string | undefined,
  method: string,
  params: unknown,
  nativeFile?: string
): Promise<unknown> {
  if (!BROWSER_MOBILE_PAIRING_METHODS.has(method)) {
    throw new Error('invalid_params')
  }
  const schema =
    method === 'mobile.pairing.create'
      ? CreateParams
      : method === 'mobile.pairing.revoke'
        ? RevokeParams
        : EmptyParams
  if (!schema.safeParse(params ?? {}).success) {
    throw new Error('invalid_params')
  }
  const registry = server.getDeviceRegistry()
  if (!registry) {
    throw new Error('device_registry_unavailable')
  }
  if (method === 'mobile.pairing.list') {
    return {
      // Include pending grants so an unscanned code can also be revoked. Exclude phones another
      // desktop delegated here: that desktop owns them and its next sync would recreate a revoke.
      devices: registry
        .listDevices()
        .filter((device) => device.scope === 'mobile' && device.parentDeviceId === undefined)
        .map(({ deviceId, name, pairedAt, lastSeenAt }) => ({
          deviceId,
          name,
          pairedAt,
          lastSeenAt
        }))
    }
  }
  if (method === 'mobile.pairing.revoke') {
    const { deviceId } = RevokeParams.parse(params)
    if (registry.getDevice(deviceId)?.parentDeviceId !== undefined) {
      // Owned by the delegating desktop; a revoke here would not persist past its next sync.
      throw new Error('delegated_device')
    }
    return { revoked: await server.revokeMobileDevice(deviceId) }
  }
  const nativeEndpoint =
    nativeFile !== undefined ? await nativeMobilePairingEndpoint(nativeFile) : null
  const endpoint = nativeEndpoint ?? browserMobilePairingEndpoint(configuredAddress)
  if (!endpoint) {
    throw new Error('owner_route_unavailable')
  }
  if (method === 'mobile.pairing.endpoints') {
    return {
      endpoints: [
        {
          address: endpoint,
          provenance:
            nativeEndpoint !== null ? 'configured-tailnet-route' : 'configured-owner-route'
        }
      ]
    }
  }
  const args = CreateParams.parse(params ?? {})
  if (args.connectionMode !== 'local-only') {
    throw new Error('unsupported_connection_mode')
  }
  if (args.address !== undefined && browserMobilePairingEndpoint(args.address) !== endpoint) {
    throw new Error('invalid_advertised_endpoint')
  }
  // Do not orphan a cloud invite by replacing a desktop-created pending Relay grant.
  if (registry.getPendingDevice('mobile')?.relayBinding) {
    throw new Error('relay_pending_conflict')
  }
  const offer = server.createPairingOffer({
    address: endpoint,
    scope: 'mobile',
    reach: 'this-computer',
    name: 'Mobile',
    rotate: args.rotate
  })
  if (!offer.available) {
    return offer
  }
  registry.setMobilePairingConnectionMode(offer.deviceId, 'local-only')
  const qr = await encodeMobilePairingQr(offer.pairingUrl)
  if (!registry.getDevice(offer.deviceId)) {
    throw new Error('pairing_request_superseded')
  }
  return {
    available: true,
    pairingUrl: offer.pairingUrl,
    endpoint: offer.endpoint,
    deviceId: offer.deviceId,
    connectionMode: 'local-only',
    qrDataUrl: qr.ok ? qr.qrDataUrl : null,
    qrSize: qr.ok ? qr.qrSize : null,
    ...(!qr.ok ? { qrError: 'encoding_failed' } : {})
  }
}

export function browserMobilePairingError(error: unknown): { code: string; message: string } {
  const messages: Record<string, string> = {
    invalid_params: 'Invalid mobile pairing request.',
    owner_route_unavailable: 'A secure owner route is not configured for mobile pairing.',
    native_route_unavailable:
      'The configured native tailnet route is unavailable. Browser access is unchanged.',
    unsupported_connection_mode:
      'Choose LAN to use the configured route; browser Relay setup is unavailable.',
    invalid_advertised_endpoint:
      'Select the configured route without credentials, query parameters or fragments.',
    relay_pending_conflict: 'Revoke the pending Relay pairing before creating an owner-route code.',
    pairing_request_superseded: 'The pairing code was replaced or revoked. Generate a new code.',
    device_registry_unavailable: 'The pairing registry is unavailable.'
  }
  const code =
    error instanceof Error && Object.hasOwn(messages, error.message)
      ? error.message
      : 'mobile_pairing_unavailable'
  return {
    code,
    message: messages[code] ?? 'Mobile pairing is unavailable. Retry after reconnecting.'
  }
}
