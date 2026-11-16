/**
 * Find: the PCs running Personas on this network that are not paired yet
 * (found by mDNS, `link.linkablePeers`). Picking one connects to it if needed
 * and asks it to pair; the derived step then moves to Code by itself.
 *
 * While nothing has turned up the list shows calm ghost rows, and after a few
 * seconds of nothing it explains the usual causes instead of spinning forever.
 */
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { KitHost, ListRow, Rows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { DiscoveredPeer } from '@/api/network/discovery';
import { SetupHelp } from './SetupHelp';

/** How long an empty list may look like "still looking" before the help shows. */
export const SETUP_HELP_AFTER_MS = 8000;

interface FindStepProps {
  peers: DiscoveredPeer[];
  isBusy: (peerId: string) => boolean;
  onPick: (peer: DiscoveredPeer) => void;
  onRefresh: () => void;
}

export function FindStep({ peers, isBusy, onPick, onRefresh }: FindStepProps) {
  const { t } = useTranslation();
  const st = t.sharing;
  const empty = peers.length === 0;
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!empty) return;
    const timer = setTimeout(() => setShowHelp(true), SETUP_HELP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [empty]);

  const anyBusy = peers.some((p) => isBusy(p.peer_id));

  return (
    <div data-testid="wizard-find" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="typo-body text-foreground">{empty ? st.wizard_find_looking : st.wizard_find_intro}</p>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          data-testid="nearby-refresh"
          onClick={onRefresh}
        >
          {st.refresh}
        </Button>
      </div>

      <KitHost>
        <div data-testid="nearby-devices">
          <Rows
            loading={empty && !showHelp}
            count={peers.length}
            empty={{ title: st.wizard_find_empty_title, hint: st.wizard_find_empty_hint, testId: 'nearby-empty' }}
          >
            {peers.map((peer) => {
              const status = peer.is_connected ? st.wizard_find_online : st.wizard_find_on_network;
              return (
                <ListRow
                  key={peer.peer_id}
                  testId={`nearby-device-${peer.peer_id}`}
                  name={peer.display_name}
                  meta={status}
                  mark={{ tone: peer.is_connected ? 'success' : 'neutral', label: status }}
                  figures={
                    <Button
                      size="sm"
                      loading={isBusy(peer.peer_id)}
                      disabled={anyBusy && !isBusy(peer.peer_id)}
                      data-testid={`nearby-link-${peer.peer_id}`}
                      onClick={() => onPick(peer)}
                    >
                      {st.link_device}
                    </Button>
                  }
                />
              );
            })}
          </Rows>
        </div>
      </KitHost>

      {empty && showHelp && <SetupHelp />}

      <p className="typo-caption text-foreground">{st.wizard_find_next}</p>
    </div>
  );
}
