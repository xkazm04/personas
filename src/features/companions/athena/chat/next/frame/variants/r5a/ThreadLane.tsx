/**
 * One run thread (a project lane, or Athena's own) in its two sizes - the
 * SAME object, slim or widened:
 *
 * - `ThreadPill`: a 30px glass pill on the window's right edge. Its runs as one
 *   segmented bar (each state its share; the board spells the states out as
 *   shaped ticks: running = filled capsule, stuck = square, waiting = diamond), its
 *   name set vertically, and - when anything in it is blocked on you - a
 *   human-colour tab with a raised hand that breaks the column's silhouette.
 *   Shape and glyph carry the gate, so it reads across the room and without
 *   colour.
 * - `ThreadLaneWide`: the board's lane - what waits on you first, then each
 *   run with its state and how long since it last moved.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { Hand } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { NEXT_COPY as C } from '../../../nextCopy';
import { ISLAND_COPY as I } from './copy';
import { plainWords, splitLead } from './plainWords';
import type { ThreadLane, ThreadRun } from './useThreads';

const PILL_TICKS = 6;
const BAR_ORDER = ['gate', 'stuck', 'run', 'start', 'queue', 'later', 'idle'] as const;

/** The pill's micro mark: one segmented bar, each run state its share of the height. */
function MiniBar({ runs }: { runs: ThreadRun[] }) {
  const counts = BAR_ORDER.map((g) => [g, runs.filter((r) => r.glyph === g).length] as const).filter(([, n]) => n > 0);
  return (
    <span className={`r5a-bar${counts.length ? '' : ' is-empty'}`} aria-hidden>
      {counts.map(([g, n]) => (
        <i key={g} className={`g-${g}`} style={{ flexGrow: n }} />
      ))}
    </span>
  );
}

export function Ticks({ runs, row = false, cap = PILL_TICKS }: { runs: ThreadRun[]; row?: boolean; cap?: number }) {
  const shown = runs.slice(0, cap);
  const over = runs.length - shown.length;
  return (
    <span className={`r5a-ticks${row ? ' is-row' : ''}`} aria-hidden>
      {shown.map((r) => (
        <i key={r.id} className={`r5a-tick g-${r.glyph}`} />
      ))}
      {over > 0 && <span className="r5a-pill-more typo-label">{I.more(over)}</span>}
    </span>
  );
}

export function laneName(lane: ThreadLane): string {
  return lane.athena ? I.athenaLane : lane.label;
}

export function laneSummary(lane: ThreadLane): string {
  const parts = [`${lane.live} ${I.state.running}`];
  if (lane.gated + lane.asking > 0) parts.unshift(I.gate(lane.gated + lane.asking));
  return `${laneName(lane)}: ${parts.join(', ')}`;
}

export function ThreadPill({ lane, breathing, onOpen }: { lane: ThreadLane; breathing: boolean; onOpen: () => void }) {
  const gated = lane.gated + lane.asking > 0;
  return (
    <Button
      variant="ghost"
      className={`r5a-pill r5a-glass${gated ? ' is-gated' : ''}${lane.athena ? ' is-athena' : ''}`}
      onClick={onOpen}
      aria-label={`${laneSummary(lane)}. ${I.openRail}`}
      aria-keyshortcuts="Alt+T"
      data-testid="companion-r5a-thread-pill"
      data-gated={gated ? 'true' : 'false'}
    >
      {gated && (
        <span className="r5a-pill-gate" data-testid="companion-r5a-gate">
          {breathing && <span className="r5a-gate-breath is-moving" />}
          <Hand aria-hidden />
          {lane.gated > 0 && <span className="typo-label">{lane.gated}</span>}
        </span>
      )}
      <MiniBar runs={lane.runs} />
      <span className="r5a-pill-name typo-label">{laneName(lane)}</span>
    </Button>
  );
}

function Age({ run }: { run: ThreadRun }) {
  if (run.duration) return <span>{run.duration}</span>;
  const at = run.atIso ?? (run.atMs && run.atMs > 0 ? run.atMs : null);
  return at ? <RelativeTime timestamp={at} /> : null;
}

function RunRow({ run }: { run: ThreadRun }) {
  const body = (
    <>
      <span className="grid place-items-center">
        <i className={`r5a-tick g-${run.glyph}`} aria-hidden />
      </span>
      <span className="r5a-row-text">
        <span className="typo-body text-foreground">{run.label}</span>
        <span className={`typo-caption ${run.glyph === 'gate' ? 'text-role-human' : run.glyph === 'stuck' ? 'text-status-error' : ''}`}>
          {I.state[run.state] ?? run.state}
        </span>
      </span>
      <span className="r5a-row-meta typo-caption">
        <Age run={run} />
      </span>
    </>
  );
  return run.open ? (
    <Button variant="ghost" className="r5a-row" onClick={run.open}>
      {body}
    </Button>
  ) : (
    <div className="r5a-row">{body}</div>
  );
}

export function ThreadLaneWide({ lane, onOpenItem }: { lane: ThreadLane; onOpenItem: (id: string) => void }) {
  return (
    <section aria-label={laneSummary(lane)} data-testid="companion-r5a-lane">
      <div className="r5a-lane-head">
        <Ticks runs={lane.runs} row cap={10} />
        <span className={`typo-title ${lane.athena ? '' : 'text-foreground'}`}>{laneName(lane)}</span>
        <span className="flex-1" />
        {lane.gated + lane.asking > 0 && (
          <span className="r5a-gate typo-label">
            <Hand aria-hidden />
            {lane.gated + lane.asking}
          </span>
        )}
        <span className="typo-caption whitespace-nowrap">{`${lane.live} ${I.state.running}`}</span>
      </div>
      {lane.gates.map((g) => (
        <Button key={g.id} variant="ghost" className="r5a-row is-gate" onClick={() => onOpenItem(g.id)} data-testid="companion-r5a-gate-row">
          <span className="r5a-row-gate">
            <Hand aria-hidden />
          </span>
          <span className="r5a-row-text">
            <span className="typo-label text-role-human">{`${I.waitsFor} · ${C.kind[g.kind]}`}</span>
            <span className="typo-body text-foreground">{splitLead(plainWords(g.title)).lead}</span>
          </span>
          <span className="r5a-row-meta typo-caption">{g.createdAtMs > 0 && <RelativeTime timestamp={g.createdAtMs} />}</span>
        </Button>
      ))}
      {lane.runs.length === 0 && lane.gates.length === 0 && <p className="typo-caption px-2">{I.nothingRunning}</p>}
      {lane.runs.map((r) => (
        <RunRow key={r.id} run={r} />
      ))}
    </section>
  );
}
