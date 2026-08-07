/**
 * The paired-device registry.
 *
 * Home is modelled as a RADIO GROUP, not per-row switches. That is not a style
 * choice: `owned_devices` carries a partial unique index on `is_home = 1`, and
 * `set_device_home` demotes the previous home inside the same transaction. A
 * row of independent toggles would let the operator believe two devices can be
 * home at once, and then silently un-toggle one behind their back.
 */
import { useMemo } from 'react';
import { Laptop, Trash2 } from 'lucide-react';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatusDot } from '@/features/shared/components/display/StatusDot';
import { Button } from '@/features/shared/components/buttons';
import { InlineConfirm } from '@/features/settings/sub_network/components/InlineConfirm';
import { useTranslation } from '@/i18n/useTranslation';
import type { OwnedDevice } from '@/api/network/devices';
import type { DiscoveredPeer } from '@/api/network/discovery';

interface PairedDevicesPanelProps {
  devices: OwnedDevice[];
  discoveredPeers: DiscoveredPeer[];
  isLoading: boolean;
  onSetHome: (peerId: string) => void;
  onClearHome: (peerId: string) => void;
  onForget: (device: OwnedDevice) => void;
}

/** live = connected right now · paused = seen on the LAN · offline = not seen. */
function linkStateOf(peerId: string, peers: DiscoveredPeer[]): 'live' | 'paused' | 'offline' {
  const peer = peers.find((p) => p.peer_id === peerId);
  if (!peer) return 'offline';
  return peer.is_connected ? 'live' : 'paused';
}

export function PairedDevicesPanel({
  devices,
  discoveredPeers,
  isLoading,
  onSetHome,
  onClearHome,
  onForget,
}: PairedDevicesPanelProps) {
  const { t, tx } = useTranslation();
  const st = t.sharing;

  const homeDevice = devices.find((d) => d.isHome) ?? null;

  const linkLabel: Record<'live' | 'paused' | 'offline', string> = useMemo(
    () => ({
      live: st.link_state_online,
      paused: st.link_state_idle,
      offline: st.link_state_offline,
    }),
    [st.link_state_online, st.link_state_idle, st.link_state_offline],
  );

  const columns: TableColumn<OwnedDevice>[] = useMemo(
    () => [
      {
        key: 'device',
        label: st.col_device,
        width: 'minmax(180px, 2fr)',
        sortable: true,
        sortFn: (a, b) => a.displayName.localeCompare(b.displayName),
        render: (row) => (
          <div className="min-w-0">
            <p className="typo-body text-foreground truncate">{row.displayName}</p>
            <UuidLabel value={row.peerId} />
          </div>
        ),
      },
      {
        key: 'home',
        label: st.col_home,
        width: '110px',
        render: (row) => (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="personas-home-device"
              value={row.peerId}
              checked={row.isHome}
              onChange={() => onSetHome(row.peerId)}
              data-testid={`home-radio-${row.peerId}`}
              className="accent-primary"
            />
            <span className="typo-caption text-foreground">
              {row.isHome ? st.home_current : st.set_as_home}
            </span>
          </label>
        ),
      },
      {
        key: 'link',
        label: st.col_link_state,
        width: '130px',
        render: (row) => {
          const state = linkStateOf(row.peerId, discoveredPeers);
          return (
            <StatusDot kind="connection" state={state} label={linkLabel[state]}>
              <span className="typo-caption text-foreground">{linkLabel[state]}</span>
            </StatusDot>
          );
        },
      },
      {
        key: 'lastSeen',
        label: st.col_last_seen,
        width: '130px',
        render: (row) =>
          row.lastSyncedAt ? (
            <RelativeTime timestamp={row.lastSyncedAt} />
          ) : (
            <span className="typo-caption text-foreground/90">{st.never_synced}</span>
          ),
      },
      {
        key: 'actions',
        label: '',
        width: '56px',
        align: 'right',
        render: (row) => (
          <InlineConfirm
            message={tx(st.forget_device_confirm, { device: row.displayName })}
            onConfirm={() => onForget(row)}
          >
            {({ requestConfirm }) => (
              <button
                type="button"
                onClick={requestConfirm}
                data-testid={`forget-device-${row.peerId}`}
                title={st.forget_device}
                aria-label={st.forget_device}
                className="p-1.5 rounded-card hover:bg-secondary/50 text-foreground hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </InlineConfirm>
        ),
      },
    ],
    // linkLabel/tx are derived from `t`, which is stable per language.
    [st, tx, discoveredPeers, onSetHome, onForget, linkLabel],
  );

  return (
    <SectionCard
      title={st.paired_devices_title}
      subtitle={st.home_device_hint}
      icon={<Laptop className="w-4 h-4 text-cyan-400" />}
      titleClassName="text-primary"
      action={
        homeDevice ? (
          <Button
            variant="secondary"
            size="sm"
            data-testid="clear-home-device"
            onClick={() => onClearHome(homeDevice.peerId)}
          >
            {st.clear_home}
          </Button>
        ) : undefined
      }
    >
      <div role="radiogroup" aria-label={st.home_device_label} data-testid="paired-devices">
        <UnifiedTable
          columns={columns}
          data={devices}
          getRowKey={(row) => row.peerId}
          isLoading={isLoading}
          emptyTitle={st.paired_devices_empty_title}
          emptyDescription={st.paired_devices_empty_hint}
        />
      </div>
    </SectionCard>
  );
}
