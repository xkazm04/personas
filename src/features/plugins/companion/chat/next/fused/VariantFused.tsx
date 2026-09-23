/**
 * Fused · the owner's merge of round one.
 *
 * Layer one: the conversation, with the usage panel on the RIGHT (Signal's
 * efficiency, restructured as one column per affected project with decisions
 * kept apart from processes). Layer two: Roster's deck, one decision card at a
 * time at full size where the conversation was, the composer still under it.
 * The window holds a fixed 80% of the app's height (see `NextShell`).
 */

import { useMemo } from 'react';
import type { AthenaChatEngine } from '../../athenaChatEngine';
import { ConversationColumn } from '../ConversationColumn';
import { ModesPane, TurnPane } from '../NextPanes';
import { NextShell } from '../NextShell';
import { ProcessColumns } from '../ProcessColumns';
import { NEXT_COPY as C } from '../nextCopy';
import { useLayer } from '../useLayer';
import { useLayerRefOpener } from '../useLayerRefOpener';
import { ReportReader } from '../../refs/ReportReader';
import { RefOpenerProvider } from '../../refs/RefOpenerContext';
import { useProcessColumns } from '../useProcessColumns';
import { useWorkforce } from '../useWorkforce';
import { DeckLayer } from './DeckLayer';

export function VariantFused({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const workforce = useWorkforce();
  const columns = useProcessColumns(workforce, C.athena);
  const layer = useLayer();
  const { view } = layer;
  const refOpener = useLayerRefOpener(layer, workforce.items);

  const scoped = useMemo(() => {
    if (view.kind !== 'work' || view.project === null) return workforce.items;
    return workforce.items.filter((i) => i.project === view.project);
  }, [view, workforce.items]);
  const focusId = view.kind === 'work' ? (view.focus ?? scoped[0]?.id ?? null) : null;
  const about = view.kind === 'work' ? (scoped.find((i) => i.id === focusId) ?? null) : null;

  const nested =
    view.kind === 'work' ? (
      <DeckLayer
        items={scoped}
        focusId={focusId}
        lane={null}
        onFocus={(id) => layer.openWork(id, view.project)}
        onBack={layer.back}
        onSend={engine.send}
      />
    ) : view.kind === 'turn' ? (
      <div className="flex-1 overflow-y-auto scrollbar-thin px-8 py-8"><TurnPane turn={view.turn} /></div>
    ) : view.kind === 'report' ? (
      // useLayer owns Esc here, so the reader does not register its own.
      <ReportReader reportId={view.id} onClose={layer.back} overlay={false} escToClose={false} />
    ) : view.kind === 'modes' ? (
      <div className="flex-1 overflow-y-auto scrollbar-thin px-8 py-8"><ModesPane /></div>
    ) : undefined;

  return (
    <RefOpenerProvider value={refOpener}>
    <NextShell workforce={workforce} layer={layer} onInterrupt={engine.interrupt} lifted={lifted}>
      <ConversationColumn engine={engine} layer={layer} nested={nested} about={about} onClearAbout={layer.back} />
      <aside className="shrink-0 max-w-[40%] border-l border-foreground/10 bg-secondary/25 min-h-0" aria-label={C.usage}>
        <ProcessColumns
          columns={columns}
          waiting={workforce.counts.waiting}
          onOpenItem={(id) => layer.openWork(id, null)}
          onOpenWaiting={layer.toggleWork}
        />
      </aside>
    </NextShell>
    </RefOpenerProvider>
  );
}
