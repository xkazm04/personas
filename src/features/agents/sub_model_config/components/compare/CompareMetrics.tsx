import { Trophy, Clock, DollarSign, Target, FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import { scoreColor } from '@/lib/eval/evalFramework';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { formatCost } from '@/lib/utils/formatters';
import type { ModelOption, ModelMetrics } from '../../libs/compareHelpers';
import { useTranslation } from '@/i18n/useTranslation';

// -- Metric card --

export function MetricCard({
  model,
  metrics,
  isWinner,
  accent,
}: {
  model: ModelOption;
  metrics: ModelMetrics;
  isWinner: boolean;
  accent: 'blue' | 'amber';
}) {
  const borderColor = isWinner
    ? accent === 'blue' ? 'border-blue-500/30' : 'border-amber-500/30'
    : 'border-primary/10';
  const bgColor = isWinner
    ? accent === 'blue' ? 'bg-blue-500/5' : 'bg-amber-500/5'
    : 'bg-background/30';

  return (
    <div className={`px-3 py-2.5 rounded-modal border ${borderColor} ${bgColor} space-y-2`}>
      <div className="flex items-center gap-2">
        <span className="typo-heading font-semibold text-foreground/90">{model.label}</span>
        {isWinner && <Trophy className="w-3 h-3 text-primary" />}
      </div>

      {/* An em dash, not a 0: a model whose rows were never graded has no
          composite to state, and painting one as zero is the fold this panel
          used to make. */}
      <div className={`typo-data-lg font-bold tabular-nums ${scoreColor(metrics.composite)}`}>
        {metrics.composite ?? '—'}
      </div>

      <MetricRows metrics={metrics} />
    </div>
  );
}

function MetricRows({ metrics }: { metrics: ModelMetrics }) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  return (
    // All four figures go through `<Numeric>`, which defaults to the active UI
    // language. They read `.toFixed()` / `.toLocaleString()` until 2026-08-29 —
    // en-US separators in a 14-locale app, seven of whose locales use a decimal
    // comma. The precision of each is a deliberate choice, not the primitive's
    // default:
    //  - latency keeps one decimal on seconds, matching CompareResultsTable's
    //    per-row cell exactly (`unit="s"` would round 4.2s to "4s");
    //  - cost keeps FOUR decimals via pre-formatted `formatCost`, because this
    //    panel exists to tell two models' spend apart and `unit="usd"` drops to
    //    three below a dollar, collapsing $0.0523 and $0.0518 onto one figure;
    //  - token counts are integers — grouped, never fractional.
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 typo-caption">
      <MetricRow
        icon={Clock}
        label={mc.latency}
        value={<><Numeric value={metrics.avgDuration / 1000} precision={1} />s</>}
      />
      <MetricRow
        icon={DollarSign}
        label={mc.cost}
        value={<Numeric>{formatCost(metrics.totalCost, { precision: 4 })}</Numeric>}
      />
      <MetricRow
        icon={Target}
        label={mc.tokens_in}
        value={<Numeric value={metrics.totalInputTokens} unit="count" precision={0} />}
      />
      <MetricRow
        icon={FileText}
        label={mc.tokens_out}
        value={<Numeric value={metrics.totalOutputTokens} unit="count" precision={0} />}
      />
    </div>
  );
}

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  /** A rendered figure — `<Numeric>`, not a pre-joined string. */
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 text-foreground">
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{label}:</span>
      <span className="text-foreground font-mono ml-auto">{value}</span>
    </div>
  );
}

// -- Compare bar (horizontal dual bar) --

export function CompareBar({
  label,
  labelIcon: Icon,
  valueA,
  valueB,
}: {
  label: string;
  labelIcon: typeof Target;
  /** `null` = the dimension was never scored for this model. Renders an em
   *  dash and an empty bar — a zero-length bar would read as a measured 0. */
  valueA: number | null;
  valueB: number | null;
}) {
  const max = Math.max(valueA ?? 0, valueB ?? 0, 1);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 typo-caption text-foreground">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        {/* A bar (right-aligned, blue) */}
        <div className="flex-1 flex justify-end">
          <div className="h-2.5 rounded-full bg-blue-500/30 overflow-hidden" style={{ width: `${((valueA ?? 0) / max) * 100}%` }}>
            <div className="h-full bg-blue-500 rounded-full" style={{ width: '100%' }} />
          </div>
        </div>
        <div className="w-16 text-center typo-code font-mono tabular-nums">
          <span className={scoreColor(valueA)}>{valueA ?? '—'}</span>
          <span className="text-foreground mx-0.5">:</span>
          <span className={scoreColor(valueB)}>{valueB ?? '—'}</span>
        </div>
        {/* B bar (left-aligned, amber) */}
        <div className="flex-1">
          <div className="h-2.5 rounded-full bg-amber-500/30 overflow-hidden" style={{ width: `${((valueB ?? 0) / max) * 100}%` }}>
            <div className="h-full bg-amber-500 rounded-full" style={{ width: '100%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
