// Classic: the whole fleet as bays of one panel. Bays flow into as many
// columns as the width allows and the panel grows downward, so forty projects
// are four screens of scroll, not a sideways drag. Workspace groups come first
// (the model already orders them), device columns last, and the ungrouped tray
// is the panel's widest bay at the foot.

import { useCallback, useMemo, type ReactNode } from 'react';
import { Laptop, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';
import { effectiveRemoteState } from '@/lib/network/remoteSessionModel';
import type { ColumnRow } from '../../gridGeometry';
import type { BoardColumn } from '../../useBoardModel';
import type { ActivitySurface } from '../useActivitySurface';
import { PersonaWindow } from './PersonaWindow';
import { SessionWindow } from './SessionWindow';
import { Bay } from './Bay';
import { BayGhosts } from './Ghosts';
import { sessionLamp, toneClass } from './tone';
import { Engraved, Lamp } from './parts';

const TICK_MS = 30_000;

export function ClassicPanel({
  surface, selectedPersonaId, onOpenRemote,
}: {
  surface: ActivitySurface;
  selectedPersonaId: string | null;
  onOpenRemote?: (jobId: string) => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  useFixedTicker(TICK_MS);
  const now = Date.now();
  const { model, select, focusKey, bubbles, unseen, setTerminal, setRecap, scope, toggleScope, reducedMotion } = surface;

  const renderRow = useCallback((row: ColumnRow): ReactNode => {
    if (row.kind === 'persona') {
      return (
        <PersonaWindow
          card={row.card}
          selected={row.card.personaId === selectedPersonaId}
          onSelect={select}
          flash={focusKey === `p:${row.card.personaId}`}
          bubble={bubbles.get(row.card.personaId) ?? null}
          unseenChat={unseen.get(row.card.personaId) ?? 0}
        />
      );
    }
    if (row.kind === 'session') {
      return (
        <SessionWindow
          session={row.session}
          onOpen={setTerminal}
          onRecap={setRecap}
          flash={focusKey === `s:${row.session.id}`}
          now={now}
        />
      );
    }
    if (row.kind === 'remote') {
      const state = effectiveRemoteState(row.view, now);
      const lamp = state === 'unknown' ? { tone: 'off' as const, lit: false } : sessionLamp(state);
      const title = row.view.title?.trim() || row.view.projectLabel || row.view.jobId.slice(0, 8);
      const device = row.view.peerDisplayName || row.view.peerId.slice(0, 8);
      const tile = (
        <>
          <span className="flex min-w-0 items-start gap-2">
            <Lamp lamp={lamp} className="mt-[7px]" />
            <span className="ae-clamp2 min-w-0 flex-1 typo-body text-foreground">{title}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 pl-[18px] typo-caption">
            <Laptop className="h-3 w-3 flex-shrink-0" aria-hidden />
            <span className="truncate">{device}</span>
          </span>
        </>
      );
      const look = `ae-win flex w-full min-w-0 flex-col gap-0.5 rounded-input px-2.5 py-1.5 text-left ${toneClass(lamp.tone)} ${lamp.lit ? 'is-lit' : ''}`;
      // Without a handler the tile opens nothing, so it is a readout, not a control.
      if (!onOpenRemote) return <div className={look} data-testid="fleet-grid-remote">{tile}</div>;
      return (
        <Button
          variant="ghost"
          onClick={() => onOpenRemote(row.view.jobId)}
          data-testid="fleet-grid-remote"
          className={`ae-win ae-focus w-full min-w-0 rounded-input px-2.5 py-1.5 text-left [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-0.5 ${toneClass(lamp.tone)} ${lamp.lit ? 'is-lit' : ''}`}
        >
          {tile}
        </Button>
      );
    }
    return null;
  }, [selectedPersonaId, select, focusKey, bubbles, unseen, setTerminal, setRecap, onOpenRemote, now]);

  const onScope = useCallback(
    (c: BoardColumn) => toggleScope(c.teamId, c.teamName, c.cards),
    [toggleScope],
  );

  const tray = useMemo(() => [
    ...model.ungrouped.map((card) => ({ kind: 'persona' as const, key: `p:${card.personaId}`, height: 0, card, teamName: null })),
    ...model.traySessions.map((session) => ({ kind: 'session' as const, key: `s:${session.id}`, height: 0, session })),
  ], [model.ungrouped, model.traySessions]);

  if (surface.cold) return <BayGhosts />;
  if (model.empty) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6" data-testid="entry-e-empty">
        <ScenarioEmptyState icon={Users} title={model.filtered ? m.grid_filter_empty : m.channels_combined_quiet} />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-label={m.grid_board_aria} data-testid="entry-e-classic">
      <div className="grid items-start gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(218px, 1fr))' }}>
        {model.columns.map((column, i) => (
          <Bay
            key={column.teamId}
            column={column}
            index={i}
            scoped={scope?.teamId === column.teamId}
            onScope={onScope}
            renderRow={renderRow}
            reducedMotion={reducedMotion}
          />
        ))}
        {tray.length > 0 && (
          <section className="ae-plate col-span-full flex flex-col gap-2 rounded-card p-2.5" data-testid="entry-e-tray">
            <span className="flex items-center gap-2 px-1">
              <Users className="h-3.5 w-3.5 text-foreground" aria-hidden />
              <Engraved>{m.grid_ungrouped}</Engraved>
              <span className="typo-data tabular-nums text-foreground">{tray.length}</span>
            </span>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
              {tray.map((row) => <div key={row.key}>{renderRow(row)}</div>)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
