// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkInterfacePicker } from './NetworkInterfacePicker'
import { TooltipProvider } from '../ui/tooltip'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const noop = vi.fn()

function renderPicker(props: {
  networkInterfaces?: { name: string; address: string }[]
  customAddresses?: string[]
  selectedAddress?: string
}): void {
  render(
    <NetworkInterfacePicker
      networkInterfaces={props.networkInterfaces ?? []}
      customAddresses={props.customAddresses ?? []}
      selectedAddress={props.selectedAddress}
      selectedAddressIsCustom={false}
      onSelectedAddressChange={noop}
      onCustomAddressSelect={noop}
      onCustomAddressRemove={noop}
    />,
    { wrapper: TooltipProvider }
  )
}

describe('NetworkInterfacePicker', () => {
  it.each(['owner', 'tailnet'])(
    'offers a configured %s route separately from NIC discovery',
    async (kind) => {
      const address =
        kind === 'tailnet' ? 'wss://workspace.pilot.ts.net/' : 'wss://owner.example.test/apps/orca/'
      vi.stubGlobal('api', {
        mobile: {
          listPairingEndpoints: vi.fn().mockResolvedValue({
            endpoints: [{ address, provenance: `configured-${kind}-route` }]
          })
        }
      })
      renderPicker({})
      expect(screen.getByRole('status').textContent).toContain('not NIC discovery')
      fireEvent.click(screen.getByRole('combobox'))
      fireEvent.click(
        await screen.findByRole('option', { name: new RegExp(`configured ${kind} route`) })
      )
      expect(noop).toHaveBeenCalledWith(address)
    }
  )

  it('does not claim there are no interfaces when unselected options exist', () => {
    renderPicker({ networkInterfaces: [{ name: 'docker0', address: '172.17.0.1' }] })

    expect(screen.getByRole('combobox').textContent).toContain('No address selected')
  })

  it('reports an empty interface list when there is genuinely nothing to pick', () => {
    renderPicker({})

    expect(screen.getByRole('combobox').textContent).toContain('No interfaces found')
  })

  it('shows the selected interface instead of any placeholder', () => {
    renderPicker({
      networkInterfaces: [{ name: 'en0', address: '192.168.1.24' }],
      selectedAddress: '192.168.1.24'
    })

    expect(screen.getByRole('combobox').textContent).toContain('192.168.1.24 (en0)')
  })
})
