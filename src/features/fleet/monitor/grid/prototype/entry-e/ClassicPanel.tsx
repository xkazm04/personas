// Classic: the whole fleet as bays of one panel, laid as masonry so a bay is
// exactly as tall as its roster and the next bay fills the gap below it.
// Agents are one line each, live sessions two. The panel filter narrows agents
// AND sessions; a bay the filter empties leaves the board. The ungrouped tray
// is the widest bay, at the foot, in as many columns as the width allows.
//
// WINDOWING — which axis, and why not `grid/ColumnBody`.
//
// `ColumnBody` is the board's virtualized column and its header carries the
// measurement that makes this worth doing at all (p95 frame 36.3 → 106.6 ms
// between 60 and 100 nodes). Its ARGUMENT transfers here unchanged: virtualize
// the axis that is actually unbounded — the rows inside one bay, and the tray —
// not the number of bays, which is the number of projects the operator has.
// Its CODE does not, for two reasons measured against this surface:
//
//  • It hands the virtualizer `estimateSize` and never measures. That needs a
//    constant height per row kind, and this panel has none: `PersonaLine` sets
//    `minHeight`, not `height`, and GROWS when the persona has a chat bubble
//    (two clamped lines); `RemoteLine` declares no height at all. A column of
//    fixed-height nodes can be placed arithmetically; a list of lines has to be
//    measured, so these virtualizers run `measureElement`.
//  • Its rows are `ColumnRow`s whose heights come from `gridGeometry` (the TILE
//    board: 54 / 42 px). Entry E's lines are 36 / 50. Reusing the type would
//    mean carrying heights that are wrong for every row on this surface.
//
// Below `VIRTUALIZE_ABOVE` rows each list renders EXACTLY the DOM it rendered
// before — no wrapper, no scroller, no measure pass. A six-agent bay is not
// asked to pay for a valve it cannot benefit from.

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Users } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from '@/i18n/useTranslation';
import { useQuantizedNow } from '@/hooks/utility/timing/relativeTimeTicker';
import { useElementSize } from '@/hooks/utility/interaction/useElementSize';
import { effectiveRemoteState } from '@/lib/network/remoteSessionModel';
import { VIRTUALIZE_ABOVE, type ColumnRow } from '../../gridGeometry';
import type { BoardColumn } from '../../useBoardModel';
import type { ActivitySurface } from '../useActivitySurface';
import { PersonaLine, PERSONA_LINE_H } from './PersonaLine';
import { SessionLine, SESSION_LINE_H } from './SessionLine';
import { Bay, ShareBar } from './Bay';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { BayGhosts } from './Ghosts';
import { Engraved } from './parts';
import { RemoteLine } from './RemoteLine';
import { useAmbientMotionClass } from './useAmbientMotion';
import type { PanelFilter } from './boardFilter';
import type { WorkspaceScope } from './workspaceScope';

const TICK_MS = 30_000;

/** The bay's own scroll cap — `Bay`'s `max-h-[24rem]`, in px. */
const BAY_MAX_H = 384;
/** The hairline between a bay's roster and its live sessions: 1px + `my-1`. */
const SEPARATOR_H = 9;
/** The tray grid's `minmax(280px, …)` and its `columnGap`. */
const TRAY_MIN_W = 280;
const TRAY_GAP = 10;

/** One addressable line of a windowed list, with a FIRST GUESS at its height. */
interface LineRow {
  key: string;
  /**
   * The row's height in CSS pixels — a FIRST GUESS only, since every windowed
   * row is then measured (see the header). Named for the layout quantity and
   * not for its confidence: the census's `estimate-typed-as-measurement` rule
   * is about a value a user reads, and this one never leaves the layout.
   */
  px: number;
  node: ReactNode;
}

const rowPx = (row: ColumnRow): number => (row.kind === 'persona' ? PERSONA_LINE_H : SESSION_LINE_H);

/**
 * A bay's lines, windowed above `VIRTUALIZE_ABOVE`.
 *
 * The virtualized branch owns a scroller of its own, capped at exactly the cap
 * `Bay` already puts on the box it renders this into, so the bay's painted
 * height is unchanged and the outer box simply never scrolls.
 */
function BayLines({ rows }: { rows: LineRow[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const estimateSize = useCallback((i: number) => rows[i]?.px ?? 0, [rows]);
  const virtualize = rows.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 6,
  });

  if (!virtualize) return <>{rows.map((r) => r.node)}</>;

  return (
    <div
      ref={parentRef}
      className="min-h-0 overflow-y-auto overscroll-contain"
      style={{ maxHeight: BAY_MAX_H }}
      data-testid="entry-e-bay-window"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          return (
            <div
              key={row.key}
              data-index={v.index}
              data-row-key={row.key}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${v.start}px)` }}
            >
              {row.node}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The ungrouped tray: a wrapped grid, windowed BY ROW above
 * `VIRTUALIZE_ABOVE` cells.
 *
 * A grid cannot be windowed without knowing how many cells share a row, and
 * `auto-fill` keeps that number in the browser. So above the threshold the
 * panel computes the wrap itself from the same two numbers the CSS uses, and
 * lays the cells out in explicit rows of that width — the same arithmetic
 * `gridGeometry.trayPerRow` does one surface over.
 */
function TrayGrid({ cells }: { cells: LineRow[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(parentRef);
  const virtualize = cells.length > VIRTUALIZE_ABOVE;
  const perRow = Math.max(1, Math.floor((width + TRAY_GAP) / (TRAY_MIN_W + TRAY_GAP)));

  const rows = useMemo(() => {
    const out: LineRow[][] = [];
    for (let i = 0; i < cells.length; i += perRow) out.push(cells.slice(i, i + perRow));
    return out;
  }, [cells, perRow]);

  const estimateSize = useCallback(
    (i: number) => rows[i]?.reduce((h, c) => Math.max(h, c.px), 0) ?? 0,
    [rows],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 4,
  });

  const template = { gridTemplateColumns: `repeat(auto-fill, minmax(${TRAY_MIN_W}px, 1fr))`, columnGap: TRAY_GAP };
  // Unwindowed, and before the first measurement, the body is byte-for-byte
  // the grid the tray has always been.
  const windowed = virtualize && width > 0;

  // The measured element is the SAME element in both branches, deliberately: a
  // `ref` that moves when the list crosses the threshold leaves the
  // `ResizeObserver` watching a detached node, and the width it reports then
  // never changes again.
  return (
    <div
      ref={parentRef}
      className={`min-w-0 ${windowed ? 'overflow-y-auto overscroll-contain' : ''}`}
      style={windowed ? { maxHeight: BAY_MAX_H } : undefined}
      data-testid={windowed ? 'entry-e-tray-window' : undefined}
    >
      {!windowed ? (
        <div className="grid" style={template}>
          {cells.map((c) => c.node)}
        </div>
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index];
            if (!row) return null;
            return (
              <div
                key={row[0]?.key ?? v.index}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className="absolute inset-x-0 top-0 grid"
                style={{ ...template, transform: `translateY(${v.start}px)` }}
              >
                {row.map((c) => c.node)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ClassicPanel({
  surface, filter, workspaces, selectedPersonaId, onOpenRemote, onClearFilter,
}: {
  surface: ActivitySurface;
  filter: PanelFilter;
  /** The notepad's current sheet: which workspace's bays this panel draws. */
  workspaces: WorkspaceScope;
  selectedPersonaId: string | null;
  onOpenRemote?: (jobId: string) => void;
  onClearFilter: () => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  // `now` moves on the shared ticker and NOWHERE ELSE. Reading `Date.now()` in
  // render made `keep`, `renderRow` and therefore the `bays` memo change
  // identity on every render — a hover, a store write, a parent's re-render —
  // and under the ticker's old 1 Hz contagion that was once a second.
  const now = useQuantizedNow(TICK_MS);
  const motion = useAmbientMotionClass();
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
    if (row.kind === 'remote') return <RemoteLine key={row.key} view={row.view} now={now} onOpen={onOpenRemote} />;
    return null;
  }, [selectedPersonaId, select, focusKey, bubbles, unseen, setTerminal, setRecap, onOpenRemote, now]);

  const bays = useMemo(() => model.columns.filter((c) => workspaces.keepTeam(c.teamId)).map((column) => {
    const rows = column.rows.filter(keep);
    const personas = rows.filter((r) => r.kind === 'persona');
    const live = rows.filter((r) => r.kind === 'session' || r.kind === 'remote');
    return { column, personas, live, show: !filter.active || rows.length > 0 };
  }).filter((b) => b.show), [model.columns, keep, filter.active, workspaces]);

  // One bay's lines, in paint order: the roster, the hairline, then what is
  // live. The hairline is a ROW rather than a wrapper because the windowed
  // branch places rows at computed offsets and cannot see a wrapper's margins.
  const bayLines = useCallback((personas: ColumnRow[], live: ColumnRow[]): LineRow[] => {
    const lines: LineRow[] = personas.map((r) => ({ key: r.key, px: rowPx(r), node: renderRow(r) }));
    if (live.length > 0 && personas.length > 0) {
      lines.push({
        key: '__divider',
        px: SEPARATOR_H,
        node: <span key="__divider" aria-hidden className="mx-2.5 my-1 block h-px bg-primary/25" />,
      });
    }
    for (const r of live) lines.push({ key: r.key, px: rowPx(r), node: renderRow(r) });
    return lines;
  }, [renderRow]);

  // The tray is what no project claims, so no workspace claims it either: on a
  // named sheet it is not narrowed, it is absent.
  const trayCards = useMemo(
    () => (workspaces.active ? [] : model.ungrouped.filter(filter.card)),
    [model.ungrouped, filter, workspaces.active],
  );
  const traySessions = useMemo(
    () => (workspaces.active ? [] : model.traySessions.filter(filter.session)),
    [model.traySessions, filter, workspaces.active],
  );
  const trayCells = useMemo((): LineRow[] => [
    ...trayCards.map((card) => ({
      key: `p:${card.personaId}`,
      px: PERSONA_LINE_H,
      node: renderRow({ kind: 'persona', key: card.personaId, height: 0, card, teamName: null }),
    })),
    ...traySessions.map((s) => ({
      key: `s:${s.id}`,
      px: SESSION_LINE_H,
      node: renderRow({ kind: 'session', key: s.id, height: 0, session: s }),
    })),
  ], [trayCards, traySessions, renderRow]);

  const onScope = useCallback((c: BoardColumn) => toggleScope(c.teamId, c.teamName, c.cards), [toggleScope]);

  if (surface.cold) return <BayGhosts />;
  if (bays.length === 0 && trayCards.length === 0 && traySessions.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6" data-testid="entry-e-empty">
        {filter.active
          ? <ScenarioEmptyState icon={Users} title="No card is in this state." action={{ label: t.common.clear, onClick: onClearFilter }} />
          : <ScenarioEmptyState icon={Users} title={m.channels_combined_quiet} />}
      </div>
    );
  }

  return (
    <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${motion}`} aria-label={m.grid_board_aria} data-testid="entry-e-classic">
      <div className="ae-bays">
        {bays.map(({ column, personas, live }) => (
          <Bay
            key={column.teamId}
            column={column}
            liveCount={live.length}
            scoped={scope?.teamId === column.teamId}
            onScope={onScope}
            rows={<BayLines rows={bayLines(personas, live)} />}
          />
        ))}
      </div>
      {trayCells.length > 0 && (
        <section className="ae-plate flex flex-col gap-1 overflow-hidden rounded-card pb-1" data-testid="entry-e-tray">
          <span className="flex items-center gap-2 px-3 py-2">
            <Users className="h-3.5 w-3.5 text-foreground" aria-hidden />
            <Engraved>{m.grid_ungrouped}</Engraved>
            <span className="ml-auto typo-caption tabular-nums">{trayCards.length} · {traySessions.length}</span>
          </span>
          <ShareBar cards={trayCards} />
          <TrayGrid cells={trayCells} />
        </section>
      )}
    </div>
  );
}
