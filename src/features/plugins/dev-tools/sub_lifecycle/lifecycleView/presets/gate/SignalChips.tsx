/**
 * A gate row's signals as chips beside its kind: "Flaky" (the outcome keeps
 * flipping) and "Slowing down" (the backend's slow-gate regression rule holds
 * on its recent runs). Each chip's tip says the evidence in numbers, and a
 * slowing command with a slow-gate item already on the backlog names it.
 */
import { Shuffle, TrendingUp } from 'lucide-react';

import { Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { Pill } from '../../system/Pill';
import type { PillLook } from '../../system/pillLooks';
import type { CommandSignals } from './signals';

const FLAKY_LOOK: PillLook = { tone: 'warning', stroke: 'hairline', glyph: Shuffle };
const SLOWING_LOOK: PillLook = { tone: 'warning', stroke: 'hairline', glyph: TrendingUp };

export function SignalChips({ signals, commandId }: { signals: CommandSignals; commandId: string }) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const { flaky, slowing, filed } = signals;
  if (!flaky && !slowing) return null;
  const slowWhy = slowing
    ? [
        tx(dl.lcx6_slowing_why, {
          recent: slowing.recentRuns,
          recentMean: formatNumeric(slowing.recentMeanMs, 'ms'),
          pct: formatNumeric((slowing.ratio - 1) * 100, 'percent', { precision: 0, language }),
          priorMedian: formatNumeric(slowing.priorMedianMs, 'ms'),
          prior: slowing.priorRuns,
        }),
        filed ? tx(dl.lcx6_slowing_filed, { title: filed.title }) : null,
      ].filter(Boolean).join(' ')
    : '';
  return (
    <span className="inline-flex items-center gap-1.5">
      {flaky && (
        <Hint content={tx(dl.lcx6_flaky_why, { flips: flaky.flips, count: flaky.window.length, passes: flaky.passes, failures: flaky.failures })}>
          <span className="inline-flex" data-testid={`lc6-flaky-${commandId}`}>
            <Pill look={FLAKY_LOOK} label={dl.lcx6_signal_flaky} data={{ 'data-signal': 'flaky' }} />
          </span>
        </Hint>
      )}
      {slowing && (
        <Hint content={slowWhy}>
          <span className="inline-flex" data-testid={`lc6-slowing-${commandId}`} data-filed={filed ? 'true' : undefined}>
            <Pill look={SLOWING_LOOK} label={dl.lcx6_signal_slowing} data={{ 'data-signal': 'slowing' }} />
          </span>
        </Hint>
      )}
    </span>
  );
}
