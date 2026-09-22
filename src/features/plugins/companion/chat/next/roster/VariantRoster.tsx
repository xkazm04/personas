/**
 * Variant A · Roster + Deck.
 *
 * Layer one: the conversation, and on the right a roster of bullets, one row
 * per project with a live task, decision dots at the row's end. Layer two: a
 * deck that shows ONE decision at a time at full size where the conversation
 * was, with the composer still under it, replying about the card in focus.
 */

import { useMemo } from 'react';
import type { AthenaChatEngine } from '../../athenaChatEngine';
import { ConversationColumn } from '../ConversationColumn';
import { ModesPane, TurnPane } from '../NextPanes';
import { NextShell } from '../NextShell';
import { useLayer } from '../useLayer';
import { switchThread, useWorkforce } from '../useWorkforce';
import { DeckLayer } from './DeckLayer';
import { RosterPanel } from './RosterPanel';

export function VariantRoster({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const workforce = useWorkforce();
  const layer = useLayer();
  const { view } = layer;

  const scoped = useMemo(() => {
    if (view.kind !== 'work' || view.project === null) return workforce.items;
    return workforce.items.filter((i) => i.project === view.project);
  }, [view, workforce.items]);
  const focusId = view.kind === 'work' ? (view.focus ?? scoped[0]?.id ?? null) : null;
  const about = view.kind === 'work' ? (scoped.find((i) => i.id === focusId) ?? null) : null;
  const lane = view.kind === 'work' && view.project ? (workforce.lanes.find((l) => l.project === view.project) ?? null) : null;

  const nested =
    view.kind === 'work' ? (
      <DeckLayer
        items={scoped}
        focusId={focusId}
        lane={lane}
        onFocus={(id) => layer.openWork(id, view.project)}
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
      <ConversationColumn
        engine={engine}
        layer={layer}
        nested={nested}
        about={about}
        onClearAbout={layer.back}
      />
      <RosterPanel
        workforce={workforce}
        activeProject={view.kind === 'work' ? view.project : undefined}
        onOpenProject={(p) => layer.openWork(null, p)}
        onOpenItem={(id) => layer.openWork(id, null)}
        onOpenThread={switchThread}
      />
    </NextShell>
  );
}
