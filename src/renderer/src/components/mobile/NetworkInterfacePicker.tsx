import React, { useEffect, useMemo, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { AddressPicker, type AddressOption } from '../network/AddressPicker'
import { parseManualNetworkAddress } from '../../../../shared/network/manual-address'
import type { MobileApi } from '../../../../preload/api/mobile-api'
import type { MobileNetworkInterface } from '../settings/mobile-network-interface-selection'

function formatCustomAddressLabel(address: string): string {
  return translate(
    'auto.components.mobile.NetworkInterfacePicker.custom-option',
    '{{address}} (custom)',
    { address }
  )
}

export type NetworkInterfacePickerProps = {
  networkInterfaces: readonly MobileNetworkInterface[]
  customAddresses: readonly string[]
  selectedAddress: string | undefined
  selectedAddressIsCustom: boolean
  onSelectedAddressChange: (address: string) => void
  onCustomAddressSelect: (address: string) => void
  onCustomAddressRemove: (address: string) => void
  beforeCustomAddressChange?: (address: string) => boolean | Promise<boolean>
  disabled?: boolean
  className?: string
  id?: string
}

export function NetworkInterfacePicker({
  networkInterfaces,
  customAddresses,
  selectedAddress,
  selectedAddressIsCustom,
  onSelectedAddressChange,
  onCustomAddressSelect,
  onCustomAddressRemove,
  beforeCustomAddressChange,
  disabled = false,
  className,
  id
}: NetworkInterfacePickerProps): React.JSX.Element {
  const [configuredEndpoints, setConfiguredEndpoints] = useState<
    Awaited<ReturnType<NonNullable<MobileApi['listPairingEndpoints']>>>['endpoints']
  >([])
  const [endpointError, setEndpointError] = useState(false)
  const listPairingEndpoints = window.api?.mobile?.listPairingEndpoints
  useEffect(() => {
    let active = true
    if (listPairingEndpoints) {
      void listPairingEndpoints()
        .then(({ endpoints }) => {
          if (active) {
            setConfiguredEndpoints(endpoints)
            setEndpointError(false)
          }
        })
        .catch(() => {
          if (active) {
            setEndpointError(true)
          }
        })
    }
    return () => {
      active = false
    }
  }, [listPairingEndpoints])
  const options = useMemo<AddressOption[]>(
    () =>
      networkInterfaces.map((iface) => ({
        value: iface.address,
        label: `${iface.address} (${iface.name})`
      })),
    [networkInterfaces]
  )
  const customOptions = useMemo<AddressOption[]>(
    () =>
      [...new Set([...configuredEndpoints.map(({ address }) => address), ...customAddresses])].map(
        (address) => {
          const route = configuredEndpoints.find((endpoint) => endpoint.address === address)
          return {
            value: address,
            label: route
              ? `${address} (${route.provenance === 'configured-tailnet-route' ? 'configured tailnet route' : 'configured owner route'})`
              : formatCustomAddressLabel(address)
          }
        }
      ),
    [customAddresses, configuredEndpoints]
  )
  // Bridge-only hosts have selectable options but no default address; do not label that list empty.
  const placeholder =
    options.length > 0 || customOptions.length > 0
      ? translate(
          'auto.components.mobile.NetworkInterfacePicker.no-address-selected',
          'No address selected'
        )
      : translate(
          'auto.components.settings.MobileNetworkInterfaceSection.b2c384cfd6',
          'No interfaces found'
        )

  return (
    <>
      {listPairingEndpoints && (
        <p role="status">
          {endpointError
            ? translate(
                'auto.components.mobile.NetworkInterfacePicker.configured-route-unavailable',
                'Configured route unavailable. Check native ingress and reopen pairing; browser access is unchanged.'
              )
            : translate(
                'auto.components.mobile.NetworkInterfacePicker.configured-route',
                'Use the configured route. This is not NIC discovery or proof of phone connectivity. Tailnet access follows tailnet policy, not Coder login. Pending codes have no automatic expiry; replace or revoke unused codes.'
              )}
        </p>
      )}
      <AddressPicker
        options={options}
        customOptions={customOptions}
        value={selectedAddress}
        valueIsCustom={selectedAddressIsCustom}
        onValueChange={onSelectedAddressChange}
        onCustomValueChange={onCustomAddressSelect}
        onCustomRemove={onCustomAddressRemove}
        beforeCustomConfirm={beforeCustomAddressChange}
        disabled={disabled}
        className={className}
        id={id}
        formatCustomLabel={formatCustomAddressLabel}
        customSectionLabel={translate(
          'auto.components.mobile.NetworkInterfacePicker.custom-section',
          'Custom'
        )}
        removeCustomLabel={(address) =>
          translate(
            'auto.components.mobile.NetworkInterfacePicker.remove-custom',
            'Remove {{address}}',
            { address }
          )
        }
        addCustomLabel={translate(
          'auto.components.mobile.NetworkInterfacePicker.add-custom',
          'Add custom address…'
        )}
        placeholder={placeholder}
        triggerAriaLabel={translate(
          'auto.components.mobile.NetworkInterfacePicker.trigger-label',
          'Network address to advertise'
        )}
        customInputId="custom-network-address-input"
        validateCustom={(input) => {
          if (listPairingEndpoints && (input.includes('?') || input.includes('#'))) {
            return { ok: false }
          }
          const parsed = parseManualNetworkAddress(input)
          return parsed.ok ? { ok: true, value: parsed.address } : { ok: false }
        }}
        customDialogCopy={{
          title: translate(
            'auto.components.mobile.CustomNetworkAddressDialog.title',
            'Custom network address'
          ),
          description: translate(
            'auto.components.mobile.CustomNetworkAddressDialog.description',
            'Advertise an address your phone can reach — for example a Tailscale hostname, IP address, or reverse-proxy URL.'
          ),
          inputLabel: translate(
            'auto.components.mobile.CustomNetworkAddressDialog.label',
            'Address'
          ),
          placeholder: translate(
            'auto.components.mobile.CustomNetworkAddressDialog.placeholder',
            'home.example.com:8443 or https://example.com/orca'
          ),
          hint: translate(
            'auto.components.mobile.CustomNetworkAddressDialog.hint',
            'Enter an IPv4/IPv6 address, hostname, or full HTTP(S)/WebSocket URL. Ports are optional.'
          ),
          cancel: translate('auto.components.mobile.CustomNetworkAddressDialog.cancel', 'Cancel'),
          confirm: translate(
            'auto.components.mobile.CustomNetworkAddressDialog.use',
            'Use address'
          ),
          confirmationError: listPairingEndpoints
            ? 'Pairing unavailable. Use the configured route in LAN mode; reconnect if runtime access has expired.'
            : translate(
                'auto.components.mobile.CustomNetworkAddressDialog.confirmationError',
                'This address could not produce a scannable pairing code. Check the address and try again.'
              )
        }}
      />
    </>
  )
}
