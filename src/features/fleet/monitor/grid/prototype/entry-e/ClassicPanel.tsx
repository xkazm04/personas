// Classic: the whole fleet as bays of one panel, laid as masonry so a bay is
// exactly as tall as its roster and the next bay fills the gap below it.
// Agents are one line each, live sessions two. The panel filter narrows agents
// AND sessions; a bay the filter empties leaves the board. The ungrouped tray
// is the widest bay, at the foot, in as many columns as the width allows.

import { useCallback, useMemo, type ReactNode } from 'react';
import { Laptop, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';
import { effectiveRemoteState } from '@/lib/network/remoteSessionModel';
import type { ColumnRow } from '../../gridGeometry';
import type { BoardColumn } from '../../useBoardModel';
import type { ActivitySurface } from '../useActivitySurface';
import { PersonaLine } from './PersonaLine';
import { SessionLine } from './SessionLine';
import { Bay, ShareBar } from './Bay';
import { BayGhosts, PanelEmpty } from './Ghosts';
import { sessionLamp, toneClass } from './tone';
import { Engraved, Lamp } from './parts';
import type { PanelFilter } from './boardFilter';

const TICK_MS = 30_000;

export function ClassicPanel({
  surface, filter, selectedPersonaId, onOpenRemote, onClearFilter,
}: {
  surface: ActivitySurface;
  filter: PanelFilter;
  selectedPersonaId: string | null;
  onOpenRemote?: (jobId: string) => void;
  onClearFilter: () => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  useFixedTicker(TICK_MS);
  const now = Date.now();
  const { unfilteredModel: model, select, focusKey, bubbles, unseen, setTerminal, setRecap, scope, toggleScope } = surface;

  const keep = useCallback((row: ColumnRow): boolean => {
    if (row.kind === 'persona') return filter.card(row.card);
    if (row.kind === 'session') return filter.session(row.session);
    if (row.kind === 'remote') {
      const st = effectiveRemoteState(row.view, now);
      return !filter.active || (st !== 'unknown' && filter.session({ state: st, exitCode: null }));
    }
    return false;
  }, [filter, now]);

  const renderRow = useCallback((row: ColumnRow): ReactNode => {
    if (row.kind === 'persona') {
      return (
        <PersonaLine
          key={row.key}
          card={row.card}
          selected={row.card.personaId === selectedPersonaId}
          onSelect={select}
          flash={focusKey === `p:${row.card.personaId}`}
          bubble={bubbles.get(row.card.personaId) ?? null}
          unseenChat={unseen.get(row.card.personaId) ?? 0}
          now={now}
        />
      );
    }
    if (row.kind === 'session') {
      return <SessionLine key={row.key} session={row.session} onOpen={setTerminal} onRecap={setRecap} flash={focusKey === `s:${row.session.id}`} now={now} />;
    }
    if (row.kind === 'remote') {
      const state = effectiveRemoteState(row.view, now);
      const lamp = state === 'unknown' ? { tone: 'off' as const, lit: false } : sessionLamp(state);
      const title = row.view.title?.trim() || row.view.projectLabel || row.view.jobId.slice(0, 8);
      const device = row.view.peerDisplayName || row.view.peerId.slice(0, 8);
      return (
        <div
          key={row.key}
          role="button"
          tabIndex={0}
          onClick={() => onOpenRemote?.(row.view.jobId)}
          onKeyDown={(e) => { if (e.key === 'Enter') onOpenRemote?.(row.view.jobId); }}
          data-testid="fleet-grid-remote"
          className={`ae-line ae-focus flex min-w-0 cursor-pointer flex-col justify-center gap-0.5 px-2.5 py-1.5 ${toneClass(lamp.tone)} ${lamp.lit ? 'is-lit' : ''}`}
        >
          <span className="flex min-w-0 items-center gap-2"><Lamp lamp={lamp} /><span className="truncate typo-body text-foreground">{title}</span></span>
          <span className="flex min-w-0 items-center gap-1.5 pl-[18px] typo-caption"><Laptop className="h-3.5 w-3.5 flex-shrink-0" aria-hidden /><span className="truncate">{device}</span></span>
        </div>
      );
    }
    return null;
  }, [selectedPersonaId, select, focusKey, bubbles, unseen, setTerminal, setRecap, onOpenRemote, now]);

  const bays = useMemo(() => model.columns.map((column) => {
    const rows = column.rows.filter(keep);
    const personas = rows.filter((r) => r.kind === 'persona');
    const live = rows.filter((r) => r.kind === 'session' || r.kind === 'remote');
    return { column, personas, live, show: !filter.active || rows.length > 0 };
  }).filter((b) => b.show), [model.columns, keep, filter.active]);

  const trayCards = useMemo(() => model.ungrouped.filter(filter.card), [model.ungrouped, filter]);
  const traySessions = useMemo(() => model.traySessions.filter(filter.session), [model.traySessions, filter]);
  const onScope = useCallback((c: BoardColumn) => toggleScope(c.teamId, c.teamName, c.cards), [toggleScope]);

  if (surface.cold) return <BayGhosts />;
  if (bays.length === 0 && trayCards.length === 0 && traySessions.length === 0) {
    return filter.active
      ? <PanelEmpty icon={Users} heading="No card is in this state." actionLabel={t.common.clear} onAction={onClearFilter} />
      : <PanelEmpty icon={Users} heading={m.channels_combined_quiet} />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-label={m.grid_board_aria} data-testid="entry-e-classic">
      <div className="ae-bays">
        {bays.map(({ column, personas, live }) => (
          <Bay
            key={column.teamId}
            column={column}
            liveCount={live.length}
            scoped={scope?.teamId === column.teamId}
            onScope={onScope}
            rows={<>{personas.map(renderRow)}{live.length > 0 && personas.length > 0 && <span aria-hidden className="mx-2.5 my-1 h-px bg-primary/25" />}{live.map(renderRow)}</>}
          />
        ))}
      </div>
      {(trayCards.length > 0 || traySessions.length > 0) && (
        <section className="ae-plate flex flex-col gap-1 overflow-hidden rounded-card pb-1" data-testid="entry-e-tray">
          <span className="flex items-center gap-2 px-3 py-2">
            <Users className="h-3.5 w-3.5 text-foreground" aria-hidden />
            <Engraved>{m.grid_ungrouped}</Engraved>
            <span className="ml-auto typo-caption tabular-nums">{trayCards.length} · {traySessions.length}</span>
          </span>
          <ShareBar cards={trayCards} />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', columnGap: 10 }}>
            {trayCards.map((card) => renderRow({ kind: 'persona', key: card.personaId, height: 0, card, teamName: null }))}
            {traySessions.map((s) => renderRow({ kind: 'session', key: s.id, height: 0, session: s }))}
          </div>
        </section>
      )}
    </div>
  );
}
