import type * as ChildProcess from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { DeviceRegistry } from './device-registry'
import { encodePairingOffer, parsePairingCode } from '../../shared/pairing'
import type { MobileApi } from '../../preload/api/mobile-api'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import * as qrEncoder from './mobile-pairing-qr'
import {
  BROWSER_MOBILE_PAIRING_METHODS,
  browserMobilePairingEndpoint,
  nativeMobilePairingEndpoint,
  browserMobilePairingRequest
} from './runtime-rpc/runtime-rpc-browser-mobile-pairing'
import {
  authenticateMobileWsSession,
  createEncryptedWsResponseReader,
  sendEncryptedWsRequest,
  waitForWsClose,
  type AuthenticatedMobileWs
} from './runtime-rpc-mobile-ws-test-harness'
import { devicePrincipalOf } from './device-principal'
import type { AuthenticatedMobileSocket } from './rpc/mobile-socket-wiring'

const native = vi.hoisted(() => ({
  online: true,
  endpoint: 'wss://workspace.pilot.ts.net/',
  calls: 0
}))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  return {
    ...actual,
    execFile: (...args: unknown[]) => {
      if (args[0] !== '/opt/aidev/orca/runtime.sh') {
        // SAFETY: forwards the caller's own arguments, unchanged, to the real execFile.
        return (actual.execFile as (...callArgs: unknown[]) => unknown)(...args)
      }
      native.calls++
      expect(args[1]).toEqual(['tailnet', 'endpoint'])
      expect(args[2]).toMatchObject({ timeout: 18000, maxBuffer: 4096 })
      const callback = args[3] as (error: Error | null, stdout: string) => void
      callback(
        native.online ? null : new Error('private diagnostics must not escape'),
        native.endpoint
      )
      return {}
    }
  }
})
const ownerRoute = 'https://owner.example.test/@owner/workspace/apps/orca/'
type Offer = Extract<Awaited<ReturnType<MobileApi['getPairingQR']>>, { available: true }>

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

describe('browser mobile pairing owner route', () => {
  it.each([
    undefined,
    '',
    'http://owner.example.test/orca',
    'wss://127.1/orca',
    'https://localhost./orca',
    'wss://[::ffff:127.0.0.1]/orca',
    'wss://0.0.0.0/orca',
    'https://user:secret@owner.example.test/orca',
    `${ownerRoute}?token=secret`,
    `${ownerRoute}#secret`,
    `${ownerRoute}?`,
    `${ownerRoute}#`
  ])('rejects unsafe configured route %#', (address) => {
    expect(browserMobilePairingEndpoint(address)).toBeNull()
  })

  it('normalizes the operator HTTPS route without changing its path', () => {
    expect(browserMobilePairingEndpoint(ownerRoute)).toBe(ownerRoute.replace('https:', 'wss:'))
  })

  it('normalizes a validated native helper root to the canonical pairing endpoint', async () => {
    expect(native.endpoint).toBe('wss://workspace.pilot.ts.net/')
    await expect(
      nativeMobilePairingEndpoint(`${process.env.HOME}/.aidev-orca-tailnet/endpoint.json`)
    ).resolves.toBe('wss://workspace.pilot.ts.net')
  })

  it('refuses unknown native configuration and malformed helper output', async () => {
    const file = `${process.env.HOME}/.aidev-orca-tailnet/endpoint.json`
    const calls = native.calls
    for (const bad of ['', '/tmp/endpoint.json', `${file}/../other`]) {
      await expect(nativeMobilePairingEndpoint(bad)).rejects.toThrow('native_route_unavailable')
    }
    expect(native.calls).toBe(calls)
    const saved = native.endpoint
    try {
      for (const bad of [
        ownerRoute,
        'wss://workspace.pilot.ts.net/?',
        'wss://x@y.ts.net/',
        'wss://workspace.pilot.ts.net/#secret',
        'wss://workspace.pilot.ts.net/path',
        'ws://workspace.pilot.ts.net/'
      ]) {
        native.endpoint = bad
        await expect(nativeMobilePairingEndpoint(file)).rejects.toThrow('native_route_unavailable')
      }
    } finally {
      native.endpoint = saved
    }
  })

  it.each(['legacy', 'disabled', 'native'])(
    'authenticates management, isolates scopes and revokes durably (%s)',
    async (mode) => {
      const useNative = mode === 'native'
      native.online = true
      native.endpoint = mode === 'disabled' ? 'disabled' : 'wss://workspace.pilot.ts.net/'
      const nativeFile =
        mode !== 'legacy' ? `${process.env.HOME}/.aidev-orca-tailnet/endpoint.json` : undefined
      const mobileRoute = useNative ? browserMobilePairingEndpoint(native.endpoint)! : ownerRoute
      const userDataPath = mkdtempSync(join(tmpdir(), 'orca-browser-mobile-'))
      let server = new OrcaRuntimeRpcServer({
        runtime: new OrcaRuntimeService(),
        userDataPath,
        enableWebSocket: true,
        wsPort: 0,
        pinnedBindHost: '127.0.0.1',
        browserMobilePairingAddress: ownerRoute,
        nativeMobilePairingFile: nativeFile
      })
      const sessions: AuthenticatedMobileWs[] = []
      const readers: ReturnType<typeof createEncryptedWsResponseReader>[] = []
      let serial = 0
      const connect = async (pairingUrl: string) => {
        // Unit transport uses the actual loopback listener; this does NOT assert Coder admission.
        const parsed = parsePairingCode(pairingUrl)!
        const session = await authenticateMobileWsSession(
          encodePairingOffer({
            ...parsed,
            endpoint: server.getWebSocketEndpoint()!
          })
        )
        sessions.push(session)
        const reader = createEncryptedWsResponseReader(session)
        readers.push(reader)
        return { session, reader }
      }
      const call = async <T>(
        client: Awaited<ReturnType<typeof connect>>,
        method: string,
        params?: unknown
      ) => {
        const id = `request-${++serial}`
        sendEncryptedWsRequest(client.session, { id, method, params })
        return (await client.reader.next(id)) as unknown as RuntimeRpcResponse<T>
      }
      const create = async (client: Awaited<ReturnType<typeof connect>>, rotate = false) => {
        const response = await call<Offer>(client, 'mobile.pairing.create', {
          address: mobileRoute,
          connectionMode: 'local-only',
          rotate
        })
        // Never include bearer material in assertion failure output.
        expect(response.ok).toBe(true)
        if (!response.ok) {
          throw new Error('Expected mobile offer')
        }
        expect(response.result.available).toBe(true)
        return response.result
      }
      await server.start()
      try {
        const bound = server.getWebSocketEndpoint()
        const exposure = vi.spyOn(server, 'ensureNetworkExposure')
        const runtimeOffer = server.createPairingOffer({ scope: 'runtime', address: ownerRoute })
        if (!runtimeOffer.available) {
          throw new Error('Expected runtime offer')
        }
        expect(runtimeOffer.endpoint).toBe(ownerRoute.replace('https:', 'wss:'))
        const runtimeToken = parsePairingCode(runtimeOffer.pairingUrl)!.deviceToken
        const owner = await connect(runtimeOffer.pairingUrl)
        const registry = server.getDeviceRegistry()!
        const pendingRuntime = registry.addDevice('Unscanned browser', 'runtime')

        // No authentication and body-only authentication must not grant management.
        for (const method of BROWSER_MOBILE_PAIRING_METHODS) {
          for (const deviceToken of [undefined, runtimeToken]) {
            let reply: RuntimeRpcResponse<unknown> | undefined
            await server['handleWebSocketMessage'](
              JSON.stringify({ id: 'denied', method, deviceToken }),
              (raw) => {
                reply = JSON.parse(raw)
              },
              () => {}
            )
            expect(reply?.ok).toBe(false)
          }
        }
        const endpoints = await call<{ endpoints: { address: string; provenance: string }[] }>(
          owner,
          'mobile.pairing.endpoints'
        )
        expect(endpoints.ok && endpoints.result.endpoints).toEqual([
          {
            address: mobileRoute.replace('https:', 'wss:'),
            provenance: useNative ? 'configured-tailnet-route' : 'configured-owner-route'
          }
        ])
        const count = registry.listDevices().length
        await expect(
          browserMobilePairingRequest(server, ownerRoute, 'unknown', {}, nativeFile)
        ).rejects.toThrow('invalid_params')
        if (useNative) {
          native.endpoint = 'disabled'
          const disabled = await call<{ endpoints: { address: string; provenance: string }[] }>(
            owner,
            'mobile.pairing.endpoints'
          )
          expect(disabled.ok && disabled.result.endpoints).toEqual([
            { address: ownerRoute.replace('https:', 'wss:'), provenance: 'configured-owner-route' }
          ])
          native.online = false // even a disabled-looking stdout with a failed helper cannot fall back
          const offline = await call(owner, 'mobile.pairing.create', {
            connectionMode: 'local-only'
          })
          expect(!offline.ok && offline.error.code).toBe('native_route_unavailable')
          expect((await call(owner, 'status.get')).ok).toBe(true)
          expect((await call(owner, 'mobile.pairing.list')).ok).toBe(true)
          expect(registry.listDevices().length).toBe(count)
          native.endpoint = 'wss://workspace.pilot.ts.net/'
          native.online = true // enrollment/availability changes need no Orca restart
          expect(
            (
              await call(owner, 'mobile.pairing.create', {
                address: ownerRoute,
                connectionMode: 'local-only'
              })
            ).ok
          ).toBe(false) // authoritative native route, no Coder fallback
        }
        for (const params of [
          { address: 'https://other.example.test/orca', connectionMode: 'local-only' },
          { address: `${ownerRoute}?coder_session_token=secret`, connectionMode: 'local-only' },
          { address: `${ownerRoute}#secret`, connectionMode: 'local-only' },
          { address: ownerRoute.replace('/workspace/', '/other/'), connectionMode: 'local-only' },
          { connectionMode: 'automatic' },
          { connectionMode: 'local-only', scope: 'runtime' },
          { connectionMode: 'local-only', rotate: 'true' },
          { deviceId: 'bad' }
        ]) {
          expect((await call(owner, 'mobile.pairing.create', params)).ok).toBe(false)
        }
        expect(registry.listDevices().length).toBe(count)
        const first = await create(owner)
        const firstPayload = parsePairingCode(first.pairingUrl)!
        expect(firstPayload.scope).toBe('mobile')
        expect(firstPayload.endpoint).toBe(mobileRoute.replace('https:', 'wss:'))
        expect(firstPayload.relay === undefined).toBe(true)
        expect(first.qrDataUrl?.startsWith('data:image/png;base64,')).toBe(true)
        expect(first.qrSize! > 0).toBe(true)
        const rotated = await create(owner, true)
        expect(registry.validateToken(firstPayload.deviceToken) === null).toBe(true)
        expect(registry.validateToken(runtimeToken) !== null).toBe(true)
        expect(registry.getDevice(pendingRuntime.deviceId) !== null).toBe(true)
        const phoneA = await connect(rotated.pairingUrl)
        for (const method of BROWSER_MOBILE_PAIRING_METHODS) {
          const denied = await call(phoneA, method, { scope: 'runtime' })
          expect(!denied.ok && denied.error.code).toBe('forbidden')
        }
        const offerB = await create(owner, true)
        const phoneB = await connect(offerB.pairingUrl)
        expect(registry.getDevice(rotated.deviceId) !== null).toBe(true)
        const listed = await call<{ devices: Record<string, unknown>[] }>(
          owner,
          'mobile.pairing.list'
        )
        expect(listed.ok).toBe(true)
        if (listed.ok) {
          expect(listed.result.devices.length).toBe(2)
          expect(
            listed.result.devices.every(
              (device) =>
                Object.keys(device).sort().join(',') === 'deviceId,lastSeenAt,name,pairedAt'
            )
          ).toBe(true)
        }
        const revokeBrowser = await call<{ revoked: boolean }>(owner, 'mobile.pairing.revoke', {
          deviceId: runtimeOffer.deviceId
        })
        expect(revokeBrowser.ok && revokeBrowser.result.revoked).toBe(false)
        const closed = waitForWsClose(phoneA.session.ws)
        const revoked = await call<{ revoked: boolean }>(owner, 'mobile.pairing.revoke', {
          deviceId: rotated.deviceId
        })
        expect(revoked.ok && revoked.result.revoked).toBe(true)
        await closed
        expect((await call(phoneB, 'status.get')).ok).toBe(true)
        expect((await call(owner, 'status.get')).ok).toBe(true)
        const tokenA = parsePairingCode(rotated.pairingUrl)!.deviceToken
        const tokenB = parsePairingCode(offerB.pairingUrl)!.deviceToken
        const reloaded = new DeviceRegistry(userDataPath)
        expect(reloaded.validateToken(tokenA) === null).toBe(true)
        expect(reloaded.validateToken(tokenB) !== null).toBe(true)
        expect(reloaded.validateToken(runtimeToken) !== null).toBe(true)
        expect(reloaded.getMobilePairingConnectionMode(offerB.deviceId)).toBe('local-only')
        expect(server.getWebSocketEndpoint()).toBe(bound)
        expect(exposure).not.toHaveBeenCalled()

        vi.spyOn(qrEncoder, 'encodeMobilePairingQr').mockResolvedValueOnce({
          ok: false,
          reason: 'encoding_failed'
        })
        const failedQr = await create(owner)
        expect(failedQr.qrDataUrl === null && failedQr.qrError === 'encoding_failed').toBe(true)
        readers.forEach((reader) => reader.dispose())
        sessions.forEach(({ ws }) => ws.terminate())
        await server.stop()
        server = new OrcaRuntimeRpcServer({
          runtime: new OrcaRuntimeService(),
          userDataPath,
          enableWebSocket: true,
          wsPort: 0,
          pinnedBindHost: '127.0.0.1',
          browserMobilePairingAddress: ownerRoute,
          nativeMobilePairingFile: nativeFile
        })
        await server.start()
        expect(new URL(server.getWebSocketEndpoint()!).hostname).toBe('127.0.0.1')
        expect(server.getDeviceRegistry()!.validateToken(tokenA) === null).toBe(true)
        expect((await call(await connect(runtimeOffer.pairingUrl), 'status.get')).ok).toBe(true)
        expect((await call(await connect(offerB.pairingUrl), 'status.get')).ok).toBe(true)
      } finally {
        native.endpoint = 'wss://workspace.pilot.ts.net/'
        native.online = true
        readers.forEach((reader) => reader.dispose())
        sessions.forEach(({ ws }) => ws.terminate())
        await server.stop()
        vi.restoreAllMocks()
        rmSync(userDataPath, { recursive: true, force: true })
      }
    }
  )

  // Orca Web signs in with a device key when it can, so management must accept a key-proved
  // runtime socket that carries no bearer token, and still refuse a key-proved phone.
  it('accepts a key-authenticated runtime socket and refuses a key-authenticated phone', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-browser-mobile-keyed-'))
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: false,
      pinnedBindHost: '127.0.0.1',
      browserMobilePairingAddress: ownerRoute
    })
    const registry = new DeviceRegistry(userDataPath)
    server['deviceRegistry'] = registry
    const keyedSocket = (deviceId: string, key: number): AuthenticatedMobileSocket => ({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: dispatch only uses ws as a map key for abort registration.
      ws: {} as AuthenticatedMobileSocket['ws'],
      connectionId: `connection-${key}`,
      transcriptHashB64: Buffer.alloc(32).toString('base64'),
      device: devicePrincipalOf(
        registry.forkDeviceKey(deviceId, Buffer.alloc(32, key).toString('base64'), 'Browser')
      ),
      clientCapabilities: [],
      transport: { transport: 'direct' }
    })
    const send = async (socket: AuthenticatedMobileSocket, method: string) => {
      const replies: string[] = []
      await server['handleWebSocketMessage'](
        JSON.stringify({ id: method, method }),
        (raw) => replies.push(raw),
        () => {},
        undefined,
        undefined,
        null,
        socket
      )
      return JSON.parse(replies.at(-1)!) as RuntimeRpcResponse<unknown>
    }
    try {
      const browser = keyedSocket(registry.addDevice('Browser', 'runtime').deviceId, 5)
      const phone = keyedSocket(registry.addDevice('Phone', 'mobile').deviceId, 6)
      const endpoints = await send(browser, 'mobile.pairing.endpoints')
      expect(endpoints.ok && endpoints.result).toEqual({
        endpoints: [
          { address: ownerRoute.replace('https:', 'wss:'), provenance: 'configured-owner-route' }
        ]
      })
      expect((await send(browser, 'mobile.pairing.list')).ok).toBe(true)
      for (const method of BROWSER_MOBILE_PAIRING_METHODS) {
        const denied = await send(phone, method)
        expect(!denied.ok && denied.error.code).toBe('forbidden')
      }
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
