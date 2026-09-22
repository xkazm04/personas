/**
 * Variant C · Threads + Rooms.
 *
 * Layer one: the threads Athena is holding in parallel (herself, each project
 * with a live task, other conversations) on the left, the conversation beside
 * them. Layer two: a room per thread, its processes and everything waiting in
 * it side by side, at the conversation's full size.
 */

import type { AthenaChatEngine } from '../../athenaChatEngine';
import { ConversationColumn } from '../ConversationColumn';
import { ModesPane, TurnPane } from '../NextPanes';
import { NextShell } from '../NextShell';
import { NEXT_COPY as C } from '../nextCopy';
import { useLayer } from '../useLayer';
import { switchThread, useWorkforce } from '../useWorkforce';
import { RoomLayer } from './RoomLayer';
import { ThreadRail } from './ThreadRail';

export function VariantRooms({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const workforce = useWorkforce();
  const layer = useLayer();
  const { view } = layer;

  const room = view.kind === 'work' ? view.project : undefined;
  const lane = room ? (workforce.lanes.find((l) => l.project === room) ?? null) : null;
  const items = room === null ? workforce.looseItems : (lane?.items ?? []);
  const about = view.kind === 'work' ? (items[0] ?? null) : null;

  const nested =
    view.kind === 'work' ? (
      <RoomLayer
        title={room ?? C.opsLabel}
        lane={lane}
        ops={room === null ? workforce.ops : []}
        items={items}
        onBack={layer.back}
        onSend={engine.send}
      />
    ) : view.kind === 'turn' ? (
      <div className="flex-1 overflow-y-auto scrollbar-thin px-8 py-8"><TurnPane turn={view.turn} /></div>
    ) : view.kind === 'modes' ? (
      <div className="flex-1 overflow-y-auto scrollbar-thin px-8 py-8"><ModesPane /></div>
    ) : undefined;

  return (
    <NextShell workforce={workforce} layer={layer} onInterrupt={engine.interrupt} lifted={lifted}>
      <ThreadRail
        workforce={workforce}
        active={room}
        onOpenRoom={(p) => layer.openWork(null, p)}
        onOpenThread={switchThread}
      />
      <ConversationColumn engine={engine} layer={layer} nested={nested} about={about} onClearAbout={layer.back} />
    </NextShell>
  );
}
