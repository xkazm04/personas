/**
 * Settings → Devices, "Your PCs". The production-reachable half of the P2P
 * surface: this PC, a card per paired PC, the drawer that manages one, and
 * the guided "Add a PC" wizard.
 *
 * The wizard is open while the operator asked for it OR a pairing request is
 * waiting here, so the receiving PC lands straight on its Approve step.
 *
 * Exposure, bundles, enclaves and the raw diagnostic peer list stay on the
 * dev-only Network tab. This page ships because linking your own two machines
 * is an operator task, not a debugging one.
 */
import { useCallback, useState } from 'react';
import { Laptop, Plus, WifiOff } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { KitHost, Surface } from '@/features/shared/components/kit';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { OwnedDevice } from '@/api/network/devices';
import { useDeviceLink } from '../lib/useDeviceLink';
import { PairingRefusalNotice } from './PairingRefusalNotice';
import { ThisPcCard } from './ThisPcCard';
import { DeviceCards } from './DeviceCards';
import { DeviceDrawer } from './DeviceDrawer';
import { AddPcDialog } from './wizard/AddPcDialog';

export default function DeviceLinkPage() {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const addToast = useToastStore((s) => s.addToast);
  const setDeviceHome = useSystemStore((s) => s.setDeviceHome);
  const forgetOwnedDevice = useSystemStore((s) => s.forgetOwnedDevice);

  const link = useDeviceLink();
  const [addOpen, setAddOpen] = useState(false);
  const wizardOpen = addOpen || link.incoming.length > 0;
  const [openPeerId, setOpenPeerId] = useState<string | null>(null);
  // Read through the live list, so a home change or a sync lands in the open drawer.
  const openDevice = link.ownedDevices.find((d) => d.peerId === openPeerId) ?? null;

  const handleSetHome = useCallback(
    (peerId: string, isHome: boolean) => {
      setDeviceHome(peerId, isHome).catch(
        toastCatch('features/settings/sub_devices/DeviceLinkPage:setHome', st.home_change_failed),
      );
    },
    [setDeviceHome, st.home_change_failed],
  );

  const handleForget = useCallback(
    (device: OwnedDevice) =>
      forgetOwnedDevice(device.peerId)
        .then(() => {
          addToast(tx(st.forget_device_done, { device: device.displayName }), 'success');
          return true;
        })
        .catch((err: unknown) => {
          toastCatch('features/settings/sub_devices/DeviceLinkPage:forget', st.forget_device_failed)(err);
          return false;
        }),
    [forgetOwnedDevice, addToast, tx, st.forget_device_done, st.forget_device_failed],
  );

  const openAdd = useCallback(() => setAddOpen(true), []);

  const header = (
    <ContentHeader
      icon={<Laptop className="w-5 h-5 text-cyan-400" />}
      iconColor="cyan"
      title={st.devices_title}
      subtitle={st.devices_subtitle}
      actions={
        link.p2pUnavailable ? undefined : (
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={openAdd} data-testid="devices-add-pc">
            {st.add_pc}
          </Button>
        )
      }
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
            <h3 className="typo-body text-foreground mb-1">{st.devices_unavailable_title}</h3>
            <p className="typo-caption text-foreground">{st.devices_unavailable_body}</p>
          </div>
        </ContentBody>
      </ContentBox>
    );
  }

  return (
    <ContentBox data-testid="device-link-page">
      {header}
      <ContentBody centered>
        <KitHost testId="devices-kit">
          <Surface>
            {link.outcome?.kind === 'refused' && (
              <PairingRefusalNotice outcome={link.outcome} onDismiss={link.dismissOutcome} />
            )}

            <ThisPcCard />

            <DeviceCards
              devices={link.ownedDevices}
              discoveredPeers={link.discoveredPeers}
              isLoading={link.ownedDevicesLoading}
              selectedPeerId={openPeerId}
              onOpen={(device) => setOpenPeerId(device.peerId)}
              onAdd={openAdd}
            />
          </Surface>

          <DeviceDrawer
            device={openDevice}
            discoveredPeers={link.discoveredPeers}
            onClose={() => setOpenPeerId(null)}
            onSetMain={handleSetHome}
            onForget={handleForget}
          />
        </KitHost>
      </ContentBody>

      <AddPcDialog open={wizardOpen} onClose={() => setAddOpen(false)} link={link} />
    </ContentBox>
  );
}
