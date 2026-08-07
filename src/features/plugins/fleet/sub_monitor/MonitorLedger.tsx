import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetTranslations } from '../fleetStateMeta';
import {
  attentionLane, LANE_ORDER, LANE_LABEL_KEY, LANE_TONE, type AttentionLane,
} from './monitorMeta';
import { MonitorRow } from './MonitorRow';
import type { MonitorTerminal } from './monitorTypes';

// The first two columns are the state icon and the screen-movement glyph: no
// header, they read as part of the state chrome rather than as more metrics.
const COL_KEYS: ReadonlyArray<keyof FleetTranslations | null> = [
  null, null,
  'monitor_col_session', 'monitor_col_project', 'monitor_col_procs', 'monitor_col_agents',
  'monitor_col_ctx', 'monitor_col_effort', 'monitor_col_mem', 'monitor_col_age',
];

/** First right-aligned column (`Procs` onward — everything before it is text). */
const FIRST_NUMERIC_COL = 4;

/**
 * The monitor ledger — one dense row per session, tabular numerals, every
 * stat a sortable column. Sessions are grouped
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
  fleet: MonitorTerminal[];
  onOpen: (t: MonitorTerminal) => void;
  /** Mount the shared-layout node a frame before the expand commits. */
  onArm?: (id: string) => void;
  /** Row currently owning the `monitor-term-<id>` shared layout id, if any. */
  armedId?: string | null;
}) {
  const lanes = useMemo(() => {
    const m: Record<AttentionLane, MonitorTerminal[]> = { needs_you: [], working: [], parked: [], done: [] };
    for (const t of fleet) m[attentionLane(t)].push(t);
    m.needs_you.sort((a, b) => b.ageMin - a.ageMin);
    m.working.sort((a, b) => b.outputTokens - a.outputTokens);
    m.parked.sort((a, b) => b.outputTokens - a.outputTokens);
    m.done.sort((a, b) => b.outputTokens - a.outputTokens);
    return m;
  }, [fleet]);
  const maxTokens = useMemo(() => Math.max(...fleet.map((t) => t.outputTokens), 1), [fleet]);
  const noop = useMemo(() => () => {}, []);
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-auto px-4 py-2">
      <table className="w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#0d0d10]">
            {COL_KEYS.map((key, i) => (
              <th
                key={i}
                className={`typo-label text-foreground opacity-50 font-normal px-2 py-1.5 border-b border-primary/15 ${
                  i >= FIRST_NUMERIC_COL ? 'text-right' : 'text-left'
                }`}
              >
                {key ? t.plugins.fleet[key] : null}
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
                <td colSpan={COL_KEYS.length} className="px-2 pt-3 pb-1">
                  <span className={`typo-label ${LANE_TONE[lane]}`}>
                    {t.plugins.fleet[LANE_LABEL_KEY[lane]]}
                  </span>
                  <span className="ml-2 typo-caption text-foreground opacity-40 font-data">{terms.length}</span>
                </td>
              </tr>,
              ...terms.map((term) => (
                <MonitorRow
                  key={term.id}
                  terminal={term}
                  maxTokens={maxTokens}
                  needsYou={lane === 'needs_you'}
                  armed={armedId === term.id}
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
