import { memo } from 'react';
import { motion } from 'framer-motion';
import { MoonStar } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import {
  STATE_ICON, stateMeta, costRatio, costToneBg, costToneText, ScreenHealthGlyph,
} from './monitorProtoMeta';
import type { ProtoTerminal } from './monitorTypes';

/** Shown on every stat cell of a row whose numbers are placeholders. */
const SIM_HINT = 'Placeholder stats: this session has no bound transcript yet.';

interface Props {
  t: ProtoTerminal;
  /** Fleet-wide max output tokens — the effort bar's denominator. */
  maxTokens: number;
  /** Row sits in the `needs_you` lane (tint + waiting badge). */
  needsYou: boolean;
  /**
   * This row owns the shared-layout id right now — i.e. it is the one
   * expanding into (or collapsing back from) the fullscreen pane. Every other
   * row renders a plain `<tr>`: framer's layout bookkeeping is per-element and
   * a 50-row ledger paid it 50× for an affordance only one row uses at a time.
   */
  armed: boolean;
  /** Called on pointer-down so the row can mount its motion node a frame
   *  BEFORE the expand commits — framer needs a measured box to animate from. */
  onArm: (id: string) => void;
  onOpen: (t: ProtoTerminal) => void;
}

/**
 * One session row of the monitor ledger.
 *
 * Memoized on its own terminal object: `sessionsToMonitorModel` hands back the
 * PREVIOUS object for any session whose fields did not move, so a fleet-wide
 * stats poll (or a single `FLEET_SESSION_STATE` event) re-renders only the rows
 * that actually changed instead of all of them.
 */
export const MonitorRow = memo(function MonitorRow({
  t, maxTokens, needsYou, armed, onArm, onOpen,
}: Props) {
  const meta = stateMeta(t.state);
  const Icon = STATE_ICON[t.state];
  const ratio = costRatio(t);
  // Placeholder numbers read dimmer than measured ones and say so on hover —
  // the row is real, the stats are not.
  const simCls = t.simulated ? ' opacity-40' : '';
  const simHint = t.simulated ? SIM_HINT : undefined;

  const rowProps = {
    onPointerDown: () => onArm(t.id),
    onClick: () => onOpen(t),
    className: `cursor-pointer transition-colors hover:bg-secondary/30 ${needsYou ? 'bg-violet-500/[0.05]' : ''}`,
  };

  const cells = (
    <>
      <td className="px-2 py-1 border-b border-primary/5 w-10">
        <span className="inline-flex items-center gap-1" title={`${t.state}${t.dozing ? ' · dozing' : ''}`}>
          <Icon className={`w-3.5 h-3.5 ${meta.text}`} aria-hidden="true" />
          {t.dozing && <MoonStar className="w-3 h-3 text-indigo-300" aria-hidden="true" />}
        </span>
      </td>
      <td className="px-2 py-1 border-b border-primary/5 w-6">
        <ScreenHealthGlyph health={t.screenHealth} />
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
    </>
  );

  if (!armed) return <tr {...rowProps}>{cells}</tr>;
  return <motion.tr layoutId={`proto-term-${t.id}`} {...rowProps}>{cells}</motion.tr>;
});
