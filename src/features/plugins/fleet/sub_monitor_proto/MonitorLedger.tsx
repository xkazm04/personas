import { useMemo } from 'react';
import {
  attentionLane, LANE_ORDER, LANE_LABEL, LANE_TONE, type AttentionLane,
} from './monitorProtoMeta';
import { MonitorRow } from './MonitorRow';
import type { ProtoTerminal } from './monitorTypes';

// Column 1 is the screen-movement glyph: no header, it reads as part of the
// state chrome rather than as another metric.
const COLS = ['', '', 'Session', 'Project', 'Procs', 'Agents', 'Ctx', 'Effort', 'Mem', 'Age'];

/** First right-aligned column (`Procs` onward — everything before it is text). */
const FIRST_NUMERIC_COL = 4;

/**
 * The FUSED monitor variant (winner of /prototype rounds 1-2).
 *
 * Baseline: the Ledger — one dense row per session, tabular numerals, every
 * stat a sortable column. Fused in from Triage lanes: sessions are grouped
 * under attention-lane section headers (Needs you / Working / Parked / Done,
 * always in that order), so the operator's scan path starts at the lane that
 * wants a human while keeping the ledger's compare-and-rank power.
 * "Needs you" rows sort oldest-wait first; other lanes sort by effort spent.
 *
 * Rows are memoized (`MonitorRow`) against the stable terminal objects the
 * model adapter hands back, so a fleet-wide stats poll costs only the rows
 * whose numbers moved.
 */
export function MonitorLedger({
  fleet, onOpen, onArm, armedId,
}: {
  fleet: ProtoTerminal[];
  onOpen: (t: ProtoTerminal) => void;
  /** Mount the shared-layout node a frame before the expand commits. */
  onArm?: (id: string) => void;
  /** Row currently owning the `proto-term-<id>` shared layout id, if any. */
  armedId?: string | null;
}) {
  const lanes = useMemo(() => {
    const m: Record<AttentionLane, ProtoTerminal[]> = { needs_you: [], working: [], parked: [], done: [] };
    for (const t of fleet) m[attentionLane(t)].push(t);
    m.needs_you.sort((a, b) => b.ageMin - a.ageMin);
    m.working.sort((a, b) => b.outputTokens - a.outputTokens);
    m.parked.sort((a, b) => b.outputTokens - a.outputTokens);
    m.done.sort((a, b) => b.outputTokens - a.outputTokens);
    return m;
  }, [fleet]);
  const maxTokens = useMemo(() => Math.max(...fleet.map((t) => t.outputTokens), 1), [fleet]);
  const noop = useMemo(() => () => {}, []);

  return (
    <div className="h-full overflow-auto px-4 py-2">
      <table className="w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#0d0d10]">
            {COLS.map((h, i) => (
              <th
                key={i}
                className={`typo-label uppercase tracking-wide text-foreground opacity-50 font-normal px-2 py-1.5 border-b border-primary/15 ${
                  i >= FIRST_NUMERIC_COL ? 'text-right' : 'text-left'
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LANE_ORDER.map((lane) => {
            const terms = lanes[lane];
            if (terms.length === 0) return null;
            return [
              <tr key={`lane-${lane}`}>
                <td colSpan={COLS.length} className="px-2 pt-3 pb-1">
                  <span className={`typo-label uppercase tracking-wide ${LANE_TONE[lane]}`}>{LANE_LABEL[lane]}</span>
                  <span className="ml-2 typo-caption text-foreground opacity-40 font-data">{terms.length}</span>
                </td>
              </tr>,
              ...terms.map((t) => (
                <MonitorRow
                  key={t.id}
                  t={t}
                  maxTokens={maxTokens}
                  needsYou={lane === 'needs_you'}
                  armed={armedId === t.id}
                  onArm={onArm ?? noop}
                  onOpen={onOpen}
                />
              )),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
