/**
 * One paired PC, opened from its card: what it is, whether it is the main PC,
 * the remote jobs exchanged with it, and the way to forget it. Raw ids sit in
 * the collapsed "Technical details" at the foot.
 *
 * Main PC is a switch here, not a radio row, because the drawer shows ONE PC:
 * turning it on moves the role (`set_device_home` demotes the previous main
 * PC in the same transaction) and the copy beside the switch says so.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Drawer, KeyValueGrid, Section } from '@/features/shared/components/kit';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Button } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { useTranslation } from '@/i18n/useTranslation';
import type { OwnedDevice } from '@/api/network/devices';
import type { DiscoveredPeer } from '@/api/network/discovery';
import { REACHABILITY_KEY, reachabilityOf } from '../lib/deviceReachability';
import { RemoteJobsPanel } from './RemoteJobsPanel';
import { DeviceTechnicalDetails } from './DeviceTechnicalDetails';

interface DeviceDrawerProps {
  /** The open PC, or null when the drawer is closed. */
  device: OwnedDevice | null;
  discoveredPeers: DiscoveredPeer[];
  onClose: () => void;
  onSetMain: (peerId: string, isMain: boolean) => void;
  /** Resolves true once the PC is forgotten; false when the forget failed (already toasted). */
  onForget: (device: OwnedDevice) => Promise<boolean>;
}

export function DeviceDrawer({ device, discoveredPeers, onClose, onSetMain, onForget }: DeviceDrawerProps) {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const [confirming, setConfirming] = useState(false);

  useAppKeyboard((e) => {
    if (e.key !== 'Escape' || confirming) return false;
    onClose();
    return true;
  }, { priority: ROUTE_DECISION_PRIORITY, enabled: device !== null });

  return (
    <Drawer open={device !== null} onClose={onClose} closeLabel={st.close} label={device?.displayName ?? st.close}>
      {device && (
        <div data-testid={`device-drawer-${device.peerId}`} className="space-y-6">
          <Section level={2} title={device.displayName} desc={st.rename_elsewhere_hint}>
            <KeyValueGrid
              items={[
                { k: st.reach_label, v: st[REACHABILITY_KEY[reachabilityOf(device.peerId, discoveredPeers)]] },
                {
                  k: st.last_synced_label,
                  v: device.lastSyncedAt ? <RelativeTime timestamp={device.lastSyncedAt} /> : null,
                  none: st.never_synced,
                },
                {
                  k: st.paired_on_label,
                  v: device.pairedAt ? <AbsoluteTime timestamp={device.pairedAt} variant="date" /> : null,
                  none: st.paired_on_unknown,
                },
              ]}
            />
          </Section>

          <Section level={2} title={st.main_pc_title}>
            <div className="flex items-start gap-3">
              <AccessibleToggle
                checked={device.isHome}
                onChange={() => onSetMain(device.peerId, !device.isHome)}
                label={st.main_pc_title}
                aria-describedby={`main-pc-hint-${device.peerId}`}
                data-testid={`home-radio-${device.peerId}`}
              />
              <p id={`main-pc-hint-${device.peerId}`} className="typo-caption">
                {device.isHome ? st.main_pc_on_hint : st.main_pc_hint}
              </p>
            </div>
          </Section>

          <RemoteJobsPanel peerId={device.peerId} />

          <Section level={2} title={st.forget_pc_title} desc={st.forget_pc_hint}>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => setConfirming(true)}
              data-testid={`forget-device-${device.peerId}`}
            >
              {st.forget_pc}
            </Button>
          </Section>

          <DeviceTechnicalDetails device={device} />

          {confirming && (
            <ConfirmDialog
              danger
              title={tx(st.forget_pc_confirm_title, { device: device.displayName })}
              body={st.forget_pc_hint}
              confirmLabel={st.forget_pc}
              onCancel={() => setConfirming(false)}
              onConfirm={async () => {
                const forgotten = await onForget(device);
                setConfirming(false);
                if (forgotten) onClose();
              }}
            />
          )}
        </div>
      )}
    </Drawer>
  );
}
