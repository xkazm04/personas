import type { Tone } from '@/features/shared/components/kit';

/**
 * Tone by meaning (home-2, contract item 4): the cockpit's one map from Athena's free-form
 * `intent` / `severity` / `status` words to the kit's closed `Tone` vocabulary. A colour here is
 * chosen by what a figure MEANS (spend up = warning, issues up = error, a success rate slipping =
 * warning), never by which way it moved. Draw a tone with the kit: `<Mark tone>`, `<Dot tone>`,
 * a row's `mark`, or `toneText(tone)` on a text span (`k-toned t-<tone>`, the variable a Mark reads).
 */
export type CockpitIntent = 'default' | 'info' | 'good' | 'warn' | 'bad';

const INTENT_TONE: Record<string, Tone> = {
  default: 'neutral',
  info: 'info',
  good: 'success',
  warn: 'warning',
  bad: 'error',
  // severity words Athena and connectors also use
  critical: 'error',
  high: 'error',
  medium: 'warning',
  med: 'warning',
  low: 'info',
};

/** A widget intent or severity word as a kit Tone; unknown or missing words take `fallback`. */
export function intentTone(intent: unknown, fallback: Tone = 'neutral'): Tone {
  return typeof intent === 'string' && intent in INTENT_TONE ? INTENT_TONE[intent]! : fallback;
}

/** What a figure says about itself: the fields a delta's tone is read from. */
export interface FigureMeaning {
  /** How the figure reads now: `good` | `warn` | `bad` | `info` | `default`. */
  intent?: unknown;
  /** Which way it moved: `up` | `down` | `flat`. */
  trend?: unknown;
  /** Athena's explicit tone for the delta; wins over everything else. */
  delta_intent?: unknown;
  /** Which direction is better for this figure (`up` for a success rate, `down` for spend). */
  better?: unknown;
}

/**
 * The tone of a figure's delta, by meaning:
 * 1. `delta_intent` given: that.
 * 2. `better` given: a move that way is success; the other way wears the figure's concern
 *    (error when the figure is `bad`, else warning); flat is neutral.
 * 3. Otherwise the figure's intent decides: a `warn`/`bad` figure's delta is part of the concern
 *    (spend +38% warning, issues +3 error); a `good` figure moving up stays success and slipping
 *    down is warning (success rate -1.2); a `default`/`info` figure's delta stays neutral, since
 *    nothing says whether more is better (runs +212 is not automatically good news).
 */
export function deltaTone(f: FigureMeaning): Tone {
  if (typeof f.delta_intent === 'string' && f.delta_intent in INTENT_TONE) return INTENT_TONE[f.delta_intent]!;
  const concern: Tone = f.intent === 'bad' ? 'error' : 'warning';
  if (f.better === 'up' || f.better === 'down') {
    if (f.trend !== 'up' && f.trend !== 'down') return 'neutral';
    return f.trend === f.better ? 'success' : concern;
  }
  if (f.intent === 'bad' || f.intent === 'warn') return concern;
  if (f.intent === 'good') return f.trend === 'down' ? 'warning' : 'success';
  return 'neutral';
}

/** Classes that colour a text span in a tone (neutral stays the ink it sits in). */
export function toneText(tone: Tone): string {
  return tone === 'neutral' ? '' : `k-toned t-${tone}`;
}

/**
 * @deprecated Raw-palette text class by intent; kept only until the cockpit's figure widgets
 * move to `intentTone` + `toneText` (home-2 C4). Do not add callers.
 */
export function intentTextClass(intent: string | undefined, fallback: 'default' | 'info' = 'default'): string {
  const tone = intentTone(intent, fallback === 'info' ? 'primary' : 'neutral');
  return tone === 'neutral' ? 'text-foreground' : tone === 'primary' ? 'text-primary' : `text-status-${tone}`;
}

/** @deprecated Trend-direction colour; the X5 defect. Use `deltaTone`. Do not add callers. */
export function intentTrendClass(trend: string | undefined, neutralClass = 'text-foreground'): string {
  return toneText(deltaTone({ trend, intent: 'good' })) || neutralClass;
}
