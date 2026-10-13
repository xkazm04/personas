// A paired device as a BAY of the board: the same plate a local project wears
// (`Bay`, in its "On <device>" form), holding that device's agents as
// `PersonaLine`s with their on/off switch, its queue as a `QueueLadder` whose
// order, cancel and start-now run on that device, and the sessions this device
// sent there. A device that stopped reporting greys out and says when it was
// last heard from; its switches are off until it reports again.

import { memo, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSystemStore } from '@/stores/systemStore';
import { queueOutcomeKey } from '@/stores/slices/network/meshSlice';
import type { BoardColumn, PeerColumn } from '../../../useBoardModel';
import type { QueueActions } from '../../../board/queue/useQueueActions';
import { useLocalOrder } from '../../../board/queue/useLocalOrder';
import { useQueueConfirm } from '../../shared';
import { Bay } from '../Bay';
import { Engraved } from '../parts';
import { PersonaLine } from '../PersonaLine';
import { QueueLadder } from '../QueueLadder';
import { RemoteLine } from '../RemoteLine';
import { MeshOutcomeLine } from './MeshOutcomeLine';
import { peerAgentCard, peerQueueItems } from './meshRead';

const noop = () => undefined;

/** The peer's queue as a ladder: optimistic order, verbs sent to the device, the shared confirms. */
function usePeerQueue(peer: PeerColumn) {
  const verb = useSystemStore((s) => s.remoteQueueVerb);
  const items = useMemo(() => peerQueueItems(peer.queue), [peer.queue]);
  const actions = useMemo<QueueActions>(() => ({
    // The row's outcome line carries a refusal, so the confirm always closes.
    cancel: async (sessionId) => { await verb(peer.peerId, { verb: 'queue_cancel', sessionId }); return true; },
    startNow: async (sessionId) => { await verb(peer.peerId, { verb: 'queue_start_now', sessionId }); return true; },
    // A refused reorder drops the optimistic order, so the ladder snaps back.
    reorder: async (sessionIds) => (await verb(peer.peerId, { verb: 'queue_reorder', sessionIds })).state !== 'refused',
  }), [verb, peer.peerId]);
  const order = useLocalOrder(items, actions.reorder);
  const confirm = useQueueConfirm(actions);
  return { order, confirm };
}

export const PeerBay = memo(function PeerBay({
  peer, now, reducedMotion, wide = false, onOpenRemote,
}: {
  peer: PeerColumn;
  now: number;
  reducedMotion: boolean;
  /** The board is scoped to this device: agents beside the queue, not above it. */
  wide?: boolean;
  onOpenRemote?: (jobId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const device = peer.displayName;
  const cards = useMemo(() => peer.agents.map(peerAgentCard), [peer.agents]);
  const column = useMemo<BoardColumn>(() => ({
    teamId: `mesh:${peer.peerId}`, teamName: device, teamColor: '', workspaceId: null, cards, rows: [],
    contestId: null, contestProjectId: null, remoteDevice: { peerId: peer.peerId, displayName: device },
  }), [peer.peerId, device, cards]);
  const { order, confirm } = usePeerQueue(peer);
  const running = peer.agents.filter((a) => a.running).length;

  const agents = cards.map((card, i) => {
    const agent = peer.agents[i];
    if (!agent) return null;
    return (
      <PersonaLine
        key={`p:${card.personaId}`}
        card={card}
        selected={false}
        onSelect={noop}
        flash={false}
        bubble={null}
        unseenChat={0}
        now={now}
        peer={{ peerId: peer.peerId, device, agent, stale: peer.stale }}
      />
    );
  });
  const work = (order.items.length > 0 || peer.remotes.length > 0) && (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="mesh-peer-work">
      {order.items.length > 0 && (
        <>
          <Engraved className="px-2.5 pt-1">{tx(m.mesh_queue_title, { device })}</Engraved>
          <QueueLadder
            order={order}
            items={order.items}
            now={now}
            compact
            focusKey={null}
            reducedMotion={reducedMotion}
            draggable={!peer.stale}
            onStart={confirm.askStart}
            onCancel={confirm.askCancel}
            peer
          />
        </>
      )}
      <MeshOutcomeLine outcomeKey={queueOutcomeKey(peer.peerId)} device={device} className="px-2.5" />
      {peer.remotes.map((v) => <RemoteLine key={`remote:${v.jobId}`} view={v} now={now} onOpen={onOpenRemote} />)}
    </div>
  );

  const rows = (
    <>
      {peer.stale && (
        <p className="px-3 pb-1 typo-caption" data-testid="mesh-peer-last-seen">
          {peer.receivedAtMs !== null
            ? <>{m.remote_last_seen}&nbsp;<RelativeTime timestamp={peer.receivedAtMs} showTooltip={false} /></>
            : m.remote_never_seen}
        </p>
      )}
      {wide ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col">{agents}</div>
          {work}
        </div>
      ) : (
        <>
          {agents}
          {work && <span aria-hidden className="mx-2.5 my-1 block h-px bg-primary/25" />}
          {work}
        </>
      )}
      {confirm.dialog}
    </>
  );

  return (
    <div className={peer.stale ? 'grayscale' : undefined} data-testid="mesh-peer-bay" data-peer-id={peer.peerId} data-stale={peer.stale || undefined}>
      <Bay column={column} rows={rows} liveCount={running} scoped={false} onScope={noop} />
    </div>
  );
});
