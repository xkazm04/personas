import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MoonStar } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import {
  STATE_ICON, stateMeta, costRatio, costToneBg, costToneText,
  attentionLane, LANE_ORDER,
} from './monitorProtoMeta';
import type { ProtoTerminal } from './mockFleet';

const LANE_RANK = new Map(LANE_ORDER.map((l, i) => [l, i]));

/**
 * Variant 3 — LEDGER. Metaphor: a trading terminal.
 *
 * One 28px row per session, attention-sorted, every stat a proper column
 * with tabular numerals — this is the variant for operators who want to
 * SORT and COMPARE (which session is burning the budget?) rather than
 * glance. 50 rows ≈ 1400px of scroll; the sticky header + attention sort
 * keep the actionable rows above the fold.
 */
export function VariantLedger({
  fleet, onOpen,
}: {
  fleet: ProtoTerminal[];
  onOpen: (t: ProtoTerminal) => void;
}) {
  const rows = useMemo(
    () =>
      [...fleet].sort((a, b) => {
        const lane = (LANE_RANK.get(attentionLane(a)) ?? 9) - (LANE_RANK.get(attentionLane(b)) ?? 9);
        return lane !== 0 ? lane : b.outputTokens - a.outputTokens;
      }),
    [fleet],
  );
  const maxTokens = useMemo(() => Math.max(...fleet.map((t) => t.outputTokens), 1), [fleet]);

  return (
    <div className="h-full overflow-auto px-4 py-2">
      <table className="w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#0d0d10]">
            {['', 'Session', 'Project', 'Procs', 'Agents', 'Ctx', 'Effort', 'Mem', 'Age'].map((h, i) => (
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
          {rows.map((t) => {
            const meta = stateMeta(t.state);
            const Icon = STATE_ICON[t.state];
            const ratio = costRatio(t);
            const needsYou = attentionLane(t) === 'needs_you';
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
                  <span className="block typo-caption text-foreground truncate">{t.label}</span>
                </td>
                <td className="px-2 py-1 border-b border-primary/5">
                  <span className="typo-caption text-foreground opacity-50">{t.project}</span>
                </td>
                <td className="px-2 py-1 border-b border-primary/5 text-right">
                  <Numeric align="right" className={`typo-caption ${t.subprocs ? 'text-foreground' : 'text-foreground opacity-30'}`}>{t.subprocs}</Numeric>
                </td>
                <td className="px-2 py-1 border-b border-primary/5 text-right">
                  <Numeric align="right" className={`typo-caption ${t.subagentsActive ? 'text-status-info' : 'text-foreground opacity-60'}`}>
                    {t.subagentsActive > 0 ? `${t.subagentsActive}/${t.subagentsTotal}` : `${t.subagentsTotal}`}
                  </Numeric>
                </td>
                <td className="px-2 py-1 border-b border-primary/5 text-right">
                  <Numeric align="right" className="typo-caption text-foreground opacity-70">{`${Math.round(t.contextTokens / 1000)}k`}</Numeric>
                </td>
                <td className="px-2 py-1 border-b border-primary/5 text-right">
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    <span className="w-14 h-1 rounded-full bg-secondary/40 overflow-hidden" aria-hidden="true">
                      <span className={`block h-full ${costToneBg(ratio)} opacity-70`} style={{ width: `${(t.outputTokens / maxTokens) * 100}%` }} />
                    </span>
                    <Numeric align="right" className={`typo-caption ${costToneText(ratio)}`}>{`${Math.round(t.outputTokens / 1000)}k`}</Numeric>
                  </span>
                </td>
                <td className="px-2 py-1 border-b border-primary/5 text-right">
                  <Numeric align="right" className={`typo-caption ${t.memMb ? 'text-foreground opacity-70' : 'text-foreground opacity-30'}`}>
                    {t.memMb ? `${t.memMb}` : '—'}
                  </Numeric>
                </td>
                <td className="px-2 py-1 border-b border-primary/5 text-right">
                  <Numeric align="right" className="typo-caption text-foreground opacity-50">{`${t.ageMin}m`}</Numeric>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
