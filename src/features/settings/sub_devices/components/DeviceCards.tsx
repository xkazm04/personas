/**
 * The operator's other PCs, one card each. A card says only what a person
 * needs at a glance - the name, whether it can be reached, when it last
 * synced, and whether it is the main PC - and opens the drawer for the rest.
 * No raw ids here: those live behind "Technical details" in the drawer.
 *
 * The whole card is its press target through the kit's `ContextCard onPress`
 * (its title is the one button, stretched over the card), so no local press
 * component is needed.
 */
import { Plus } from 'lucide-react';
import { ContextCard, ContextCards, Meta, Section } from '@/features/shared/components/kit';
import { Badge } from '@/features/shared/components/display/Badge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { OwnedDevice } from '@/api/network/devices';
import type { DiscoveredPeer } from '@/api/network/discovery';
import { REACHABILITY_KEY, REACHABILITY_TONE, reachabilityOf } from '../lib/deviceReachability';

/** How many ghost cards stand in for the first load. */
const GHOST_CARDS = 2;

interface DeviceCardsProps {
  devices: OwnedDevice[];
  discoveredPeers: DiscoveredPeer[];
  isLoading: boolean;
  selectedPeerId: string | null;
  onOpen: (device: OwnedDevice) => void;
  onAdd: () => void;
}

export function DeviceCards({ devices, discoveredPeers, isLoading, selectedPeerId, onOpen, onAdd }: DeviceCardsProps) {
  const { t } = useTranslation();
  const st = t.sharing;
  const firstLoad = isLoading && devices.length === 0;

  return (
    <Section
      title={st.other_pcs_title}
      count={firstLoad ? undefined : devices.length}
      state={!firstLoad && devices.length === 0 ? 'empty' : undefined}
      empty={{
        title: st.no_other_pcs_title,
        hint: st.no_other_pcs_hint,
        art: 'team',
        testId: 'devices-empty',
        action: (
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={onAdd} data-testid="devices-empty-add">
            {st.add_pc}
          </Button>
        ),
      }}
    >
      <div data-testid="paired-devices">
        <ContextCards label={st.devices_grid_label} min="240px">
          {firstLoad
            ? Array.from({ length: GHOST_CARDS }, (_, i) => (
                <ContextCard key={i} title="" state="loading" testId="device-card-ghost" />
              ))
            : devices.map((device) => {
                const reach = reachabilityOf(device.peerId, discoveredPeers);
                const reachLabel = st[REACHABILITY_KEY[reach]];
                return (
                  <ContextCard
                    key={device.peerId}
                    testId={`device-card-${device.peerId}`}
                    title={device.displayName}
                    state={device.peerId === selectedPeerId ? 'selected' : undefined}
                    mark={{ tone: REACHABILITY_TONE[reach], glyph: reach === 'online' ? 'live' : 'solid', label: reachLabel }}
                    meta={
                      <Meta
                        parts={[
                          <span key="reach" data-testid={`device-reach-${device.peerId}`}>{reachLabel}</span>,
                          device.lastSyncedAt ? (
                            <span key="sync">
                              {st.last_synced_prefix} <RelativeTime timestamp={device.lastSyncedAt} />
                            </span>
                          ) : (
                            <span key="sync">{st.never_synced}</span>
                          ),
                        ]}
                      />
                    }
                    figure={
                      device.isHome ? (
                        <Badge variant="sky" size="xs" data-testid={`device-main-badge-${device.peerId}`}>
                          {st.main_pc_badge}
                        </Badge>
                      ) : undefined
                    }
                    onPress={() => onOpen(device)}
                  />
                );
              })}
        </ContextCards>
      </div>
    </Section>
  );
}
