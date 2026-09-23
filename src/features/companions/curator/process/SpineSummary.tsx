import { useTranslation } from '@/i18n/useTranslation';
import type { SpineModel } from './engine/spine';
import { DEV_GOOD } from './engine/devAdapter';
import { pct, stationName } from './labels';

/** The three numbers the layer exists for, drawn large before the spine repeats them in detail. */
export function SpineSummary({ model }: { model: SpineModel }) {
  const { t } = useTranslation();
  const p = t.companions.process;
  const landed = model.outcomes[DEV_GOOD] ?? 0;
  const worst = model.worst[0] != null ? model.stations[model.worst[0]] : null;

  return (
    <dl className="grid grid-cols-3 gap-6 border-b border-primary/10 pb-8" data-testid="process-summary">
      <Stat figure={`${pct(landed, model.n)}%`} caption={`${landed} / ${model.n}`} label={p.stat_landed} />
      <Stat figure={`${pct(model.walkedAll, model.n)}%`} caption={`${model.walkedAll} / ${model.n}`} label={p.stat_whole} />
      <Stat
        figure={worst ? stationName(p, worst.keys) : p.stat_worst_none}
        caption={worst ? `${worst.exits} / ${worst.reached}` : ''}
        label={p.stat_worst}
        tone={worst ? 'text-status-error' : undefined}
      />
    </dl>
  );
}

function Stat({ figure, caption, label, tone }: { figure: string; caption: string; label: string; tone?: string }) {
  return (
    <div>
      <dt className="typo-body">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-3">
        <span className={`typo-hero tabular-nums ${tone ?? 'text-foreground'}`}>{figure}</span>
        <span className="typo-caption tabular-nums">{caption}</span>
      </dd>
    </div>
  );
}
