import { UnitStrip, type StatTile, type UnitSegment } from '@/features/shared/components/kit';
import { deltaTone, intentTone, toneText } from './intentColors';

/** One figure as Athena configures it in `metric_spark` and `stat_grid`. */
export interface FigureConfig {
  label?: unknown;
  value?: unknown;
  unit?: unknown;
  delta?: unknown;
  trend?: unknown;
  intent?: unknown;
  better?: unknown;
  delta_intent?: unknown;
}

const MAX_DRAWN = 40;

/**
 * The units a figure is drawn as, when a count alone is weak: "36 of 40" as 36 units of 40, and
 * a small count that carries a concern ("12 issues", "9 need attention") as that many units in
 * its tone. A large, fractional or percentage figure is stated, not drawn.
 */
function drawnUnits(f: FigureConfig): UnitSegment[] | null {
  const n = typeof f.value === 'number' ? f.value : Number(f.value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DRAWN) return null;
  const tone = intentTone(f.intent);
  const of = typeof f.unit === 'string' ? /^of (\d+)$/.exec(f.unit.trim()) : null;
  const total = of ? Number(of[1]) : 0;
  if (of && total >= n && total <= MAX_DRAWN) {
    return [{ n, tone: tone === 'neutral' ? 'primary' : tone, glyph: 'soft' }, { n: total - n, glyph: 'hollow' }];
  }
  if ((f.intent === 'bad' || f.intent === 'warn') && f.unit !== '%') return [{ n, tone }];
  return null;
}

/** A figure config as a kit StatStrip tile: figure in its own tone, delta in the tone of its meaning. */
export function figureTile(f: FigureConfig): StatTile {
  const text = f.value == null || f.value === '' ? null : String(f.value);
  const tone = toneText(intentTone(f.intent));
  const units = drawnUnits(f);
  const label = String(f.label ?? '');
  const unit = f.unit == null || f.unit === '' ? undefined : String(f.unit);
  return {
    label,
    value: text != null && tone ? <span className={tone}>{text}</span> : text,
    unit,
    note: f.delta ? <span className={`typo-caption ${toneText(deltaTone(f))}`}>{String(f.delta)}</span> : undefined,
    draw: units ? <UnitStrip size="s" segments={units} label={[text, unit, label].filter(Boolean).join(' ')} /> : undefined,
  };
}
