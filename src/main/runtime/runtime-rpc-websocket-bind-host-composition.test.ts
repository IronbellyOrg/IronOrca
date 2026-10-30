// No unused-default-rpc-methods fixture: these cases compose the real Electron runtime, which
// installs the default RPC manifest.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import type { OrcaRuntimeRpcServer } from './runtime-rpc'
import { WebSocketTransport } from './rpc/ws-transport'
import { installRuntimeRpc } from '../startup/main-process-runtime-launch'
import { getServeOptions } from '../startup/serve-options'
import { normalizeServeModeArgv } from '../startup/serve-mode-argv'

const composition = vi.hoisted(() => ({ userDataPath: '', webClientRoot: '/fixture/out/web' }))
// Exercise the actual Electron constructor composition with real RPC/lifecycle/transport;
// only unrelated desktop startup services and Electron filesystem locations are replaced.
vi.mock('electron', () => ({ app: { getPath: () => composition.userDataPath } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../persistence', () => ({
  getCanonicalUserDataPath: () => composition.userDataPath,
  migrateMobilePairingDataToCanonicalUserDataPath: vi.fn()
}))
vi.mock('../ipc/mobile', () => ({ registerMobileHandlers: vi.fn() }))
vi.mock('../startup/main-process-serve', () => ({
  getBundledWebClientRoot: () => composition.webClientRoot
}))
vi.mock('../startup/main-process-state', () => ({
  mainProcessState: { runtimeRpc: null, mainWindow: null }
}))
vi.mock('../orca-profiles/profile-cloud-auth-config', () => ({}))
vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => composition.userDataPath
}))
vi.mock('../ipc/pty', () => ({}))
vi.mock('../providers/local-pty-provider', () => ({ LocalPtyProvider: class {} }))
vi.mock('../browser/offscreen-browser-backend', () => ({}))
vi.mock('../browser/browser-manager', () => ({}))
vi.mock('../startup/main-process-relay-status', () => ({
  getDesktopRelayStatus: () => ({ status: 'offline' })
}))
vi.mock('./relay/desktop-relay-service', () => ({}))
vi.mock('../startup/main-process-pty-startup', () => ({}))
vi.mock('../startup/codex-launch-preparation', () => ({}))
vi.mock('../startup/codex-session-resume-launch', () => ({}))
vi.mock('../startup/windows-desktop-shell-path-startup', () => ({}))
vi.mock('../startup/windows-install-dir-acl-recovery', () => ({}))
vi.mock('../startup/serve-signal-handlers', () => ({}))
vi.mock('../startup/serve-desktop-activation', () => ({}))
vi.mock('./runtime-rpc-startup-failure', () => ({}))
vi.mock('../cli/cli-installer', () => ({}))
vi.mock('../cli/linux-bare-orca-dispatcher', () => ({}))
vi.mock('../terminal-history-deletion', () => ({}))
vi.mock('../ipc/startup-notification-registration', () => ({}))
vi.mock('../startup/main-process-push-startup', () => ({}))
vi.mock('../startup/startup-diagnostics', () => ({}))

vi.mock('../git/worktree', () => {
  const worktrees = [
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/foo',
      isBare: false,
      isMainWorktree: false
    }
  ]
  return {
    listWorktrees: vi.fn().mockResolvedValue(worktrees),
    listWorktreesStrict: vi.fn().mockResolvedValue(worktrees)
  }
})

describe('Electron serve composition keeps a pinned bind on loopback (aidev02 loopback-bind)', () => {
  const wsTransportOf = (server: OrcaRuntimeRpcServer): WebSocketTransport | undefined =>
    (server['activeTransports'] as unknown[]).find(
      (transport): transport is WebSocketTransport => transport instanceof WebSocketTransport
    )

  it.each([
    ['serve', '--bind', '127.0.0.1'],
    ['serve', '--bind=127.0.0.1'],
    ['--serve', '--serve-bind', '127.0.0.1'],
    ['--serve', '--serve-bind=127.0.0.1']
  ])('composes Electron argv %j into lifecycle-safe loopback', async (...entryArgs) => {
    composition.userDataPath = mkdtempSync(join(tmpdir(), 'orca-electron-bind-'))
    vi.stubEnv('ORCA_E2E_USER_DATA_DIR', '')
    vi.stubEnv('AIDEV_ORCA_NATIVE_ENDPOINT_FILE', '/home/owner/.aidev-orca-tailnet/endpoint.json')
    const options = getServeOptions(
      normalizeServeModeArgv([
        'app',
        ...entryArgs,
        '--port=0',
        '--pairing-address=https://owner.example.test/apps/orca/'
      ])
    )
    let server = installRuntimeRpc(new OrcaRuntimeService(), options)
    try {
      expect(server['webClientRoot']).toBe(composition.webClientRoot)
      expect(server['browserMobilePairingAddress']).toBe(options.pairingAddress)
      expect(server['nativeMobilePairingFile']).toBe(
        '/home/owner/.aidev-orca-tailnet/endpoint.json'
      )
      expect(server['exposeNetworkByDefault']).toBe(true)
      await server.start()
      expect(wsTransportOf(server)?.resolvedHost).toBe('127.0.0.1')
      const offer = server.createPairingOffer({ address: options.pairingAddress, scope: 'runtime' })
      expect(offer.available).toBe(true)
      if (!offer.available) {
        throw new Error('Expected a synthetic pairing offer')
      }
      expect(offer.endpoint).toBe('wss://owner.example.test/apps/orca/')
      expect(wsTransportOf(server)?.resolvedHost).toBe('127.0.0.1')
      server.getDeviceRegistry()!.updateLastSeen(offer.deviceId)
      await expect(server.ensureNetworkExposure()).rejects.toThrow(/refusing to widen/)
      await server.stop()
      server = installRuntimeRpc(new OrcaRuntimeService(), options)
      await server.start()
      expect(
        server
          .getDeviceRegistry()!
          .listDevices()
          .some((device) => device.lastSeenAt > 0)
      ).toBe(true)
      expect(wsTransportOf(server)?.resolvedHost).toBe('127.0.0.1')
      await expect(server.ensureNetworkExposure()).rejects.toThrow(/refusing to widen/)
      expect(wsTransportOf(server)?.resolvedHost).toBe('127.0.0.1')
    } finally {
      await server.stop()
      vi.unstubAllEnvs()
      rmSync(composition.userDataPath, { recursive: true, force: true })
    }
  })

  it('leaves unpinned Electron serve and desktop composition unchanged', async () => {
    composition.userDataPath = mkdtempSync(join(tmpdir(), 'orca-electron-unpinned-'))
    vi.stubEnv('ORCA_E2E_USER_DATA_DIR', '')
    const options = getServeOptions(['app', '--serve', '--serve-port=0'])
    const server = installRuntimeRpc(new OrcaRuntimeService(), options)
    try {
      expect(server['pinnedBindHost']).toBeNull()
      expect(server['webClientRoot']).toBe(composition.webClientRoot)
      await server.start()
      expect(wsTransportOf(server)?.resolvedHost).toBe('0.0.0.0')
      const desktop = installRuntimeRpc(new OrcaRuntimeService(), null)
      expect(desktop['pinnedBindHost']).toBeNull()
      expect(desktop['exposeNetworkByDefault']).toBe(false)
    } finally {
      await server.stop()
      vi.unstubAllEnvs()
      rmSync(composition.userDataPath, { recursive: true, force: true })
    }
  })
})
