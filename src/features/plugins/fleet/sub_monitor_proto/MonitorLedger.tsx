import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MoonStar } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import {
  STATE_ICON, stateMeta, costRatio, costToneBg, costToneText,
  attentionLane, LANE_ORDER, LANE_LABEL, LANE_TONE, type AttentionLane,
} from './monitorProtoMeta';
import type { ProtoTerminal } from './monitorTypes';

const COLS = ['', 'Session', 'Project', 'Procs', 'Agents', 'Ctx', 'Effort', 'Mem', 'Age'];

/** Shown on every stat cell of a row whose numbers are placeholders. */
const SIM_HINT = 'Placeholder stats: this session has no bound transcript yet.';

/**
 * The FUSED monitor variant (winner of /prototype rounds 1-2).
 *
 * Baseline: the Ledger — one dense row per session, tabular numerals, every
 * stat a sortable column. Fused in from Triage lanes: sessions are grouped
 * under attention-lane section headers (Needs you / Working / Parked / Done,
 * always in that order), so the operator's scan path starts at the lane that
 * wants a human while keeping the ledger's compare-and-rank power.
 * "Needs you" rows sort oldest-wait first; other lanes sort by effort spent.
 */
export function MonitorLedger({
  fleet, onOpen,
}: {
  fleet: ProtoTerminal[];
  onOpen: (t: ProtoTerminal) => void;
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

  return (
    <div className="h-full overflow-auto px-4 py-2">
      <table className="w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#0d0d10]">
            {COLS.map((h, i) => (
              <th
                key={i}
                className={`typo-label uppercase tracking-wide text-foreground opacity-50 font-normal px-2 py-1.5 border-b border-primary/15 ${
                  i >= 3 ? 'text-right' : 'text-left'
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
              ...terms.map((t) => {
                const meta = stateMeta(t.state);
                const Icon = STATE_ICON[t.state];
                const ratio = costRatio(t);
                const needsYou = lane === 'needs_you';
                // Placeholder numbers read dimmer than measured ones and say so
                // on hover — the row is real, the stats are not.
                const simCls = t.simulated ? ' opacity-40' : '';
                const simHint = t.simulated ? SIM_HINT : undefined;
                return (
                  <motion.tr
                    key={t.id}
                    layoutId={`proto-term-${t.id}`}
                    onClick={() => onOpen(t)}
                    className={`cursor-pointer transition-colors hover:bg-secondary/30 ${needsYou ? 'bg-violet-500/[0.05]' : ''}`}
                  >
                    <td className="px-2 py-1 border-b border-primary/5 w-10">
                      <span className="inline-flex items-center gap-1" title={`${t.state}${t.dozing ? ' · dozing' : ''}`}>
                        <Icon className={`w-3.5 h-3.5 ${meta.text}`} aria-hidden="true" />
                        {t.dozing && <MoonStar className="w-3 h-3 text-indigo-300" aria-hidden="true" />}
                      </span>
                    </td>
                    <td className="px-2 py-1 border-b border-primary/5 max-w-0 w-[38%]">
                      <span className="block typo-caption text-foreground truncate">
                        {t.label}
                        {needsYou && t.ageMin > 0 && (
                          <span className="ml-1.5 text-violet-300 opacity-80">waiting {t.ageMin}m</span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1 border-b border-primary/5">
                      <span className="typo-caption text-foreground opacity-50">{t.project}</span>
                    </td>
                    <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
                      <Numeric align="right" className={`typo-caption ${t.subprocs ? 'text-foreground' : 'text-foreground opacity-30'}${simCls}`}>{t.subprocs}</Numeric>
                    </td>
                    <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
                      <Numeric align="right" className={`typo-caption ${t.subagentsActive ? 'text-status-info' : 'text-foreground opacity-60'}${simCls}`}>
                        {t.subagentsActive > 0 ? `${t.subagentsActive}/${t.subagentsTotal}` : `${t.subagentsTotal}`}
                      </Numeric>
                    </td>
                    <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
                      <Numeric align="right" className={`typo-caption text-foreground opacity-70${simCls}`}>{`${Math.round(t.contextTokens / 1000)}k`}</Numeric>
                    </td>
                    <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
                      <span className={`inline-flex items-center gap-1.5 justify-end${simCls}`}>
                        <span className="w-14 h-1 rounded-full bg-secondary/40 overflow-hidden" aria-hidden="true">
                          <span className={`block h-full ${costToneBg(ratio)} opacity-70`} style={{ width: `${(t.outputTokens / maxTokens) * 100}%` }} />
                        </span>
                        <Numeric align="right" className={`typo-caption ${costToneText(ratio)}`}>{`${Math.round(t.outputTokens / 1000)}k`}</Numeric>
                      </span>
                    </td>
                    <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
                      <Numeric align="right" className={`typo-caption ${t.memMb ? 'text-foreground opacity-70' : 'text-foreground opacity-30'}${simCls}`}>
                        {t.memMb ? `${t.memMb}` : '—'}
                      </Numeric>
                    </td>
                    <td className="px-2 py-1 border-b border-primary/5 text-right">
                      <Numeric align="right" className="typo-caption text-foreground opacity-50">{`${t.ageMin}m`}</Numeric>
                    </td>
                  </motion.tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
