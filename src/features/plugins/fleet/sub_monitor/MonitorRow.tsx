import { memo } from 'react';
import { motion } from 'framer-motion';
import { MoonStar } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import {
  STATE_ICON, stateMeta, costRatio, costToneBg, costToneText, ScreenHealthGlyph,
} from './monitorMeta';
import type { MonitorTerminal } from './monitorTypes';

interface Props {
  terminal: MonitorTerminal;
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
  onOpen: (terminal: MonitorTerminal) => void;
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
  terminal, maxTokens, needsYou, armed, onArm, onOpen,
}: Props) {
  const { t, tx } = useTranslation();
  const meta = stateMeta(terminal.state);
  const Icon = STATE_ICON[terminal.state];
  const ratio = costRatio(terminal);
  const stateLabel = t.plugins.fleet[meta.labelKey];
  // Placeholder numbers read dimmer than measured ones and say so on hover:
  // the row is real, the stats are not.
  const simCls = terminal.simulated ? ' opacity-40' : '';
  const simHint = terminal.simulated ? t.plugins.fleet.monitor_simulated_hint : undefined;
  const tokensK = Math.round(terminal.outputTokens / 1000);

  const rowProps = {
    onPointerDown: () => onArm(terminal.id),
    onClick: () => onOpen(terminal),
    className: `cursor-pointer transition-colors hover:bg-secondary/30 ${needsYou ? 'bg-violet-500/[0.05]' : ''}`,
  };

  const cells = (
    <>
      <td className="px-2 py-1 border-b border-primary/5 w-10">
        <span
          className="inline-flex items-center gap-1"
          title={terminal.dozing ? tx(t.plugins.fleet.monitor_dozing_suffix, { state: stateLabel }) : stateLabel}
        >
          <Icon className={`w-3.5 h-3.5 ${meta.text}`} aria-hidden="true" />
          {terminal.dozing && <MoonStar className="w-3 h-3 text-indigo-300" aria-hidden="true" />}
        </span>
      </td>
      <td className="px-2 py-1 border-b border-primary/5 w-6">
        <ScreenHealthGlyph health={terminal.screenHealth} />
      </td>
      <td className="px-2 py-1 border-b border-primary/5 max-w-0 w-[38%]">
        <span className="block typo-caption text-foreground truncate">
          {terminal.label}
          {needsYou && terminal.ageMin > 0 && (
            <span className="ml-1.5 text-violet-300 opacity-80">
              {tx(t.plugins.fleet.monitor_waiting_minutes, { count: terminal.ageMin })}
            </span>
          )}
        </span>
      </td>
      <td className="px-2 py-1 border-b border-primary/5">
        <span className="typo-caption text-foreground opacity-50">{terminal.project}</span>
      </td>
      <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
        <Numeric align="right" className={`typo-caption ${terminal.subprocs ? 'text-foreground' : 'text-foreground opacity-30'}${simCls}`}>{terminal.subprocs}</Numeric>
      </td>
      <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
        <Numeric align="right" className={`typo-caption ${terminal.subagentsActive ? 'text-status-info' : 'text-foreground opacity-60'}${simCls}`}>
          {terminal.subagentsActive > 0 ? `${terminal.subagentsActive}/${terminal.subagentsTotal}` : `${terminal.subagentsTotal}`}
        </Numeric>
      </td>
      <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
        <Numeric align="right" className={`typo-caption text-foreground opacity-70${simCls}`}>{`${Math.round(terminal.contextTokens / 1000)}k`}</Numeric>
      </td>
      <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
        <span className={`inline-flex items-center gap-1.5 justify-end${simCls}`}>
          <span className="w-14 h-1 rounded-full bg-secondary/40 overflow-hidden" aria-hidden="true">
            <span className={`block h-full ${costToneBg(ratio)} opacity-70`} style={{ width: `${(terminal.outputTokens / maxTokens) * 100}%` }} />
          </span>
          <Numeric align="right" className={`typo-caption ${costToneText(ratio)}`}>{`${tokensK}k`}</Numeric>
        </span>
      </td>
      <td className="px-2 py-1 border-b border-primary/5 text-right" title={simHint}>
        <Numeric align="right" className={`typo-caption ${terminal.memMb ? 'text-foreground opacity-70' : 'text-foreground opacity-30'}${simCls}`}>
          {terminal.memMb ? `${terminal.memMb}` : '-'}
        </Numeric>
      </td>
      <td className="px-2 py-1 border-b border-primary/5 text-right">
        <Numeric align="right" className="typo-caption text-foreground opacity-50">
          {tx(t.plugins.fleet.monitor_age_minutes, { count: terminal.ageMin })}
        </Numeric>
      </td>
    </>
  );

  if (!armed) return <tr {...rowProps}>{cells}</tr>;
  return <motion.tr layoutId={`monitor-term-${terminal.id}`} {...rowProps}>{cells}</motion.tr>;
});
