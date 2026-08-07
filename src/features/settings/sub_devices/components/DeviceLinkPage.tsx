/**
 * Settings → Devices. The production-reachable half of the P2P surface:
 * pairing + the paired-device registry.
 *
 * Exposure, bundles, enclaves and the raw diagnostic peer list stay on the
 * dev-only Network tab. This page ships because linking your own two machines
 * is an operator task, not a debugging one.
 */
import { useCallback } from 'react';
import { Laptop, WifiOff } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { OwnedDevice } from '@/api/network/devices';
import { useDeviceLink } from '../lib/useDeviceLink';
import { IncomingPairingPanel } from './IncomingPairingPanel';
import { NearbyDevicesPanel } from './NearbyDevicesPanel';
import { PairedDevicesPanel } from './PairedDevicesPanel';
import { PairingCodeDialog } from './PairingCodeDialog';
import { PairingRefusalNotice } from './PairingRefusalNotice';

export default function DeviceLinkPage() {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const addToast = useToastStore((s) => s.addToast);
  const setDeviceHome = useSystemStore((s) => s.setDeviceHome);
  const forgetOwnedDevice = useSystemStore((s) => s.forgetOwnedDevice);

  const link = useDeviceLink();

  const handleSetHome = useCallback(
    (peerId: string, isHome: boolean) => {
      setDeviceHome(peerId, isHome).catch(
        toastCatch('features/settings/sub_devices/DeviceLinkPage:setHome', st.home_change_failed),
      );
    },
    [setDeviceHome, st.home_change_failed],
  );

  const handleForget = useCallback(
    (device: OwnedDevice) => {
      forgetOwnedDevice(device.peerId)
        .then(() => addToast(tx(st.forget_device_done, { device: device.displayName }), 'success'))
        .catch(
          toastCatch('features/settings/sub_devices/DeviceLinkPage:forget', st.forget_device_failed),
        );
    },
    [forgetOwnedDevice, addToast, tx, st.forget_device_done, st.forget_device_failed],
  );

  const header = (
    <ContentHeader
      icon={<Laptop className="w-5 h-5 text-cyan-400" />}
      iconColor="cyan"
      title={st.devices_title}
      subtitle={st.devices_subtitle}
    />
  );

  if (link.p2pUnavailable) {
    return (
      <ContentBox data-testid="device-link-page">
        {header}
        <ContentBody centered>
          <div
            data-testid="devices-p2p-unavailable"
            className="rounded-modal border border-dashed border-border p-8 text-center max-w-md mx-auto"
          >
            <WifiOff className="w-8 h-8 text-foreground mx-auto mb-3" />
            <h3 className="typo-body font-medium text-foreground mb-1">{st.devices_unavailable_title}</h3>
            <p className="typo-caption text-foreground leading-relaxed">{st.devices_unavailable_body}</p>
          </div>
        </ContentBody>
      </ContentBox>
    );
  }

  return (
    <ContentBox data-testid="device-link-page">
      {header}
      <ContentBody centered>
        <div className="space-y-6">
          {link.outcome?.kind === 'refused' && (
            <PairingRefusalNotice outcome={link.outcome} onDismiss={link.dismissOutcome} />
          )}

          <IncomingPairingPanel
            requests={link.incoming}
            isBusy={link.isBusy}
            onConfirm={link.confirmPairing}
            onDecline={link.cancelPairing}
          />

          <PairedDevicesPanel
            devices={link.ownedDevices}
            discoveredPeers={link.discoveredPeers}
            isLoading={link.ownedDevicesLoading}
            onSetHome={(peerId) => handleSetHome(peerId, true)}
            onClearHome={(peerId) => handleSetHome(peerId, false)}
            onForget={handleForget}
          />

          <NearbyDevicesPanel
            peers={link.linkablePeers}
            isBusy={link.isBusy}
            onLink={link.startPairing}
            onRefresh={link.refresh}
          />
        </div>
      </ContentBody>

      <PairingCodeDialog
        request={link.outgoing}
        busy={link.outgoing ? link.isBusy(link.outgoing.peerId) : false}
        onCancel={link.cancelPairing}
      />
    </ContentBox>
  );
}
