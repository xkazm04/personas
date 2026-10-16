import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import { useSheet } from '../controller/SheetContext';
import { keysFor } from '../model/keymap';
import { sheetNumber } from './header/ProjLine';
import { RAIL_GLYPH } from './rail/glyphs';
import { RailItem, type RailEntry } from './rail/RailItem';

/** The days of history the View window shows; its control arrives with the panels (Stage C). */
const VIEW_DAYS = 7;

/**
 * The right rail (bp Dock.tsx): a 64 px column of counters, Find / Review / Agents / Plan / View. Review is the Build
 * queue's toggle (its key Q): the waiting count in amber, the failed builds as a red badge. Agents counts the runs
 * the store says are running and says so when pressed; Plan names the sheet and goes back to the whole site; View
 * shows its window, disabled until the panels (flyouts) arrive in Stage C. Arrows walk the items (bp's roving rail).
 */
export function RightRail() {
  const s = useSheet();
  const { B, tx } = s.text;
  const nav = useRef<HTMLElement>(null);
  const waiting = s.queueAll.filter((p) => p.status === 'proposed').length;
  const failed = s.work.items.filter((p) => p.status === 'failed').length;
  const running = s.work.activeRuns;
  const L = s.ui.lens === 'general' ? null : s.plan.LENS[s.ui.lens] ?? null;
  const sheet = sheetNumber(L ? L.short : null);
  const items: RailEntry[] = [
    { k: 'find', label: B.find, title: B.find, glyph: RAIL_GLYPH.find, n: null, kbd: keysFor('find')[0], tone: 'ink', onPress: () => s.dispatch({ type: 'overlay', overlay: { kind: 'find' } }) },
    {
      k: 'review', label: B.review, title: B.queue_toggle, glyph: RAIL_GLYPH.review, n: waiting, tone: waiting ? 'amber' : 'ink',
      n2: failed, n2title: tx(B.review_failed, { count: failed }), on: s.ui.queueOpen, onPress: () => s.dispatch({ type: 'queue' }),
    },
    { k: 'agents', label: B.agents, title: tx(B.say_agents, { running, runs: s.work.runs.length }), glyph: RAIL_GLYPH.agents, n: running, tone: 'mint', onPress: () => s.dispatch({ type: 'say', text: tx(B.say_agents, { running, runs: s.work.runs.length }) }) },
    { k: 'plan', label: B.plan, title: tx(B.plan_title, { sheet }), glyph: RAIL_GLYPH.plan, n: sheet, tone: 'ink', onPress: () => s.nav.toLevel(0) },
    { k: 'view', label: B.view, title: B.view_title, glyph: RAIL_GLYPH.view, n: tx(B.view_days, { n: VIEW_DAYS }), tone: 'ink', disabled: true },
  ];
  const onKey = (e: KeyboardEvent) => {
    const bs = Array.from(nav.current?.querySelectorAll<HTMLButtonElement>('button.ri:not(:disabled)') ?? []);
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    const j = e.key === 'ArrowDown' ? (i + 1) % bs.length : e.key === 'ArrowUp' ? (i - 1 + bs.length) % bs.length : e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : -1;
    if (j < 0 || i < 0) return;
    e.preventDefault(); e.stopPropagation();
    bs[j]?.focus();
  };
  return (
    <nav className="bp-rr" aria-label={B.rail} ref={nav} onKeyDown={onKey} data-testid="blueprint-rail">
      {items.map((it) => <RailItem key={it.k} it={it} />)}
    </nav>
  );
}
