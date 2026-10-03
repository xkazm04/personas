import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Mark } from './Mark';
import { quantumFor } from './quantum';
import { emptyBand, GhostRows, type EmptySpec } from './states';
import { UnitStrip, apportion } from './UnitStrip';
import { cx, kitAttrs, stateClass, type Glyph, type KitStates, type Tone } from './types';

/** How many of a group's contexts are in one state (drawn as that many units). */
export interface ContextGroupState { n: number; tone: Tone; glyph?: Glyph }

export interface ContextGroupRow {
  id: string;
  name: ReactNode;
  meta?: ReactNode;
  /** The group's size (its contexts). */
  count: number;
  /** The group's worst state, on the spine. */
  mark: { tone: Tone; glyph?: Glyph; label: string };
  /** Its contexts counted by state, worst first; drawn as units at one quantum for every row. */
  states: readonly ContextGroupState[];
  /** One node per figure column (`figureHeads` names them). */
  figures?: readonly ReactNode[];
  state?: KitStates;
}

/** Units a strip may draw before the quantum steps up (1, 2, 5, ... contexts per unit). */
const MAX_UNITS = 60;

/**
 * ContextGroups: level 1 of a surface that holds many contexts. One 56px row per group on the
 * row band: the worst state as the Mark on the spine, the name and meta, the size, the group's
 * contexts drawn as units coloured by state (ONE quantum for every row, so rows compare; the
 * caller's `legend` states it), and fixed figure columns that line up down the list. A row is a
 * button that opens the group. The list is one tab stop (roving: arrows, Home, End move it) and
 * `focusId` hands focus back to the row the reader came back from.
 * @catalog ContextGroups - level 1 over many contexts: a row per group (worst mark, size, units by state, figures). Kit.
 */
export function ContextGroups({ groups, label, unitLabel, legend, figureHeads, onOpen, focusId, loading, empty }: {
  groups: readonly ContextGroupRow[];
  label: string;
  /** Accessible name of a row's strip ("14 contexts: 3 failing, ..."). */
  unitLabel: (g: ContextGroupRow) => string;
  /** Above the strips: what one unit is ("1 square = 2 contexts"). */
  legend?: (quantum: number) => ReactNode;
  figureHeads?: readonly string[];
  onOpen: (id: string) => void;
  /** Focus this row on mount (the group the reader just came back from). */
  focusId?: string | null;
  loading?: boolean;
  empty: EmptySpec;
}) {
  const [rove, setRove] = useState<string | null>(focusId ?? null);
  const list = useRef<HTMLDivElement>(null);
  const q = quantumFor(groups.reduce((m, g) => Math.max(m, g.count), 0), MAX_UNITS);
  const current = groups.some((g) => g.id === rove) ? rove : groups[0]?.id ?? null;

  useEffect(() => {
    if (focusId) list.current?.querySelector<HTMLElement>(`[data-group="${CSS.escape(focusId)}"]`)?.focus();
  }, [focusId]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? groups.length - 1 : null;
    if (next == null) return;
    e.preventDefault();
    const g = groups[Math.max(0, Math.min(groups.length - 1, next))];
    if (!g) return;
    setRove(g.id);
    list.current?.querySelector<HTMLElement>(`[data-group="${CSS.escape(g.id)}"]`)?.focus();
  };

  if (loading) return <GhostRows count={4} label={label} />;
  if (groups.length === 0) return <>{emptyBand(empty)}</>;
  const figs = figureHeads?.length ?? Math.max(0, ...groups.map((g) => g.figures?.length ?? 0));
  const style = { '--grp-figs': figs } as CSSProperties;
  return (
    <div ref={list} className="k-groups" {...kitAttrs('ContextGroups')} role="list" aria-label={label} style={style}>
      {(legend || figureHeads) && (
        <div className="k-grp k-grp--head" aria-hidden="true">
          <span /><span />
          <span className="k-grp__units typo-caption">{legend?.(q)}</span>
          {figureHeads?.map((h) => <span key={h} className="k-grp__fig typo-label k-regular k-quiet">{h}</span>)}
        </div>
      )}
      {groups.map((g, i) => (
        <div key={g.id} role="listitem" className="k-grp__item">
          <button
            type="button"
            data-group={g.id}
            className={cx('k-grp', stateClass(g.state))}
            {...kitAttrs('ContextGroup', g.state)}
            tabIndex={g.id === current ? 0 : -1}
            onFocus={() => setRove(g.id)}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onOpen(g.id)}
          >
            <Mark tone={g.mark.tone} glyph={g.mark.glyph} label={g.mark.label} />
            <span className="k-grp__name">
              <span className="typo-body k-regular k-ellipsis">{g.name}</span>
              {g.meta != null && <span className="typo-caption k-ellipsis">{g.meta}</span>}
            </span>
            <span className="k-grp__count typo-data k-regular">{g.count}</span>
            <span className="k-grp__units">
              <UnitStrip size="s" label={unitLabel(g)} segments={apportion(g.states.map((s) => ({ value: s.n, tone: s.tone, glyph: s.glyph })), q)} />
            </span>
            {Array.from({ length: figs }, (_, fi) => (
              <span key={fi} className="k-grp__fig typo-data k-regular">
                {figureHeads?.[fi] && <span className="sr-only">{figureHeads[fi]}</span>}
                {g.figures?.[fi]}
              </span>
            ))}
          </button>
        </div>
      ))}
    </div>
  );
}
