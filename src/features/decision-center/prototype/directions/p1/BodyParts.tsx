/**
 * Parts every body shares: the section head, the "if you approve" callout
 * (the answer to "what happens if I say yes"), the facts grid and the score
 * meter. One rhythm across all four types.
 */
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { KitHost, KeyValueGrid } from '@/features/shared/components/kit';
import type { TriageFact } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionItem } from '../../../model/decisionModel';
import { COPY } from './copy';
import { TONE_TEXT } from './meta';

export function Block({ label, children, aside }: { label: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h3 className="typo-eyebrow text-foreground">{label}</h3>
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** What saying yes does: the item's alert when it has one, else the kind's plain consequence. */
export function Consequence({ item }: { item: DecisionItem }) {
  const alert = item.alert;
  const tone = alert?.tone === 'danger' ? 'is-danger' : alert?.tone === 'warning' ? 'is-warning' : '';
  return (
    <div className={`p1-callout ${tone} flex items-start gap-3 px-4 py-3`}>
      <ArrowRight className={`mt-1 h-4 w-4 shrink-0 ${TONE_TEXT[alert?.tone ?? 'accent']}`} aria-hidden />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="typo-eyebrow text-foreground">{item.kind === 'report' ? COPY.sheet.ifDone : COPY.sheet.ifYes(item.verdictLabels.accept)}</span>
          {alert && <span className={`typo-label ${TONE_TEXT[alert.tone]}`}>{alert.label}</span>}
        </div>
        <p className="typo-body text-foreground">{alert?.detail ?? COPY.consequence[item.kind]}</p>
      </div>
    </div>
  );
}

export function Facts({ facts }: { facts: TriageFact[] }) {
  if (facts.length === 0) return null;
  return (
    <KitHost>
      {/* p1-kv: the grid sits flush with the sheet's text column, not on the kit's spine gutter. */}
      <div className="p1-kv">
        <KeyValueGrid min="9rem" items={facts.map((f) => ({ k: f.label, v: <span className={TONE_TEXT[f.tone ?? 'neutral']}>{f.value}</span> }))} />
      </div>
    </KitHost>
  );
}

/**
 * Meter bands over the GOODNESS of a score (0..1, already inverted for low-is-good
 * scales). Prototype-local on purpose: the triage deck colours the same facts by
 * value with no shared band table to import, and inventing one belongs to the
 * consolidation package, not to a direction.
 */
const METER_BANDS = [
  { min: 0.6, fill: 'bg-status-success' },
  { min: 0.35, fill: 'bg-status-warning' },
  { min: 0, fill: 'bg-status-error' },
] as const;

/** A 0..max meter. `invert` scales read low-is-good (effort, risk). */
export function ScoreMeter({ fact }: { fact: TriageFact }) {
  const s = fact.score;
  if (!s) return null;
  const ratio = Math.max(0, Math.min(1, s.value / s.max));
  const good = s.invert ? 1 - ratio : ratio;
  const tone = (METER_BANDS.find((b) => good >= b.min) ?? METER_BANDS[METER_BANDS.length - 1]!).fill;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="typo-label text-foreground">{fact.label}</span>
        <span className="typo-data tabular-nums text-foreground">{fact.value}<span className="typo-caption">/{s.max}</span></span>
      </div>
      <div className="p1-meter" role="meter" aria-valuenow={s.value} aria-valuemin={0} aria-valuemax={s.max} aria-label={fact.label}>
        <div className={`h-full rounded-pill ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
