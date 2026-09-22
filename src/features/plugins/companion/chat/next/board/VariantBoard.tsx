/**
 * Variant B · Signal + Board.
 *
 * Layer one: a purely graphical signal field on the left (glyphs, no words)
 * and the conversation. Layer two: a board of every waiting card at once,
 * columned by what the operator has to do, with the process band on top.
 */

import { useMemo } from 'react';
import type { AthenaChatEngine } from '../../athenaChatEngine';
import { ConversationColumn } from '../ConversationColumn';
import { ModesPane, TurnPane } from '../NextPanes';
import { NextShell } from '../NextShell';
import { useLayer } from '../useLayer';
import { switchThread, useWorkforce } from '../useWorkforce';
import { BoardLayer } from './BoardLayer';
import { SignalField } from './SignalField';

export function VariantBoard({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const workforce = useWorkforce();
  const layer = useLayer();
  const { view } = layer;

  const scoped = useMemo(() => {
    if (view.kind !== 'work' || view.project === null) return workforce.items;
    return workforce.items.filter((i) => i.project === view.project);
  }, [view, workforce.items]);
  const focusId = view.kind === 'work' ? view.focus : null;
  const about = focusId ? (scoped.find((i) => i.id === focusId) ?? null) : null;

  const nested =
    view.kind === 'work' ? (
      <BoardLayer
        items={scoped}
        lanes={workforce.lanes}
        project={view.project}
        focusId={focusId}
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
      <SignalField
        workforce={workforce}
        activeProject={view.kind === 'work' ? view.project : undefined}
        onOpenProject={(p) => layer.openWork(null, p)}
        onOpenThread={switchThread}
      />
      <ConversationColumn
        engine={engine}
        layer={layer}
        nested={nested}
        about={about}
        onClearAbout={() => layer.openWork(null, view.kind === 'work' ? view.project : null)}
        measure={view.kind === 'work' ? 'wide' : 'reading'}
      />
    </NextShell>
  );
}
