/**
 * Athena operational health in Observability (direction 6 / A4), composed from the kit: the
 * triage funnel, the proactive economy and job health are StatStrips in level-2 Sections, each
 * count drawn as units of its section's quantum in the tone of what it counts; spend follows
 * (AthenaSpendSection). Reads `companion_get_health` via {@link useAthenaHealth}.
 *
 * The error figure reads `errors / turns` on purpose: the count alone sat at a structural zero
 * for the whole life of the ledger, and a bare "0" gave no way to tell a healthy run from a
 * blind one.
 */
import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Section, StatStrip, UnitStrip, apportion, quantumFor, type StatTile, type Tone, type Glyph } from '@/features/shared/components/kit';
import { useAthenaHealth } from '../libs/useAthenaHealth';
import { AthenaSpendSection } from './AthenaSpendSection';

type Part = { label: string; n: number; tone: Tone; glyph?: Glyph };

/** One tile per part, each drawing its own count at the shared quantum. */
function tiles(parts: readonly Part[], q: number): StatTile[] {
  return parts.map((x) => ({
    label: x.label,
    value: <Numeric value={x.n} unit="count" />,
    draw: <UnitStrip size="s" rows={2} label={x.label} segments={[{ n: x.n / q, tone: x.tone, glyph: x.glyph }]} />,
  }));
}

const Legend = ({ q, label }: { q: number; label: string }) => (
  <span className="k-legend-row typo-caption">
    <span><UnitStrip size="s" label={label} segments={[{ n: 1, tone: 'neutral', glyph: 'soft' }]} /> = {q}</span>
  </span>
);

export const AthenaHealthPanel = memo(function AthenaHealthPanel({ eyebrow }: { eyebrow?: string }) {
  const { t } = useTranslation();
  const a = t.overview.athena;
  const { data, loading } = useAthenaHealth();
  const head = { id: 's-obs-athena', eyebrow, title: a.health_title, meta: a.health_hint };
  if (loading && !data) return <Section {...head} state="loading" ghostRows={3} />;
  if (!data) return null;

  const { triage, proactive, jobs, errors, turns } = data;
  const anyActivity = triage.passes > 0 || proactive.delivered > 0 || jobs.completed + jobs.failed > 0 || turns > 0 || errors > 0;
  if (!anyActivity) return <Section {...head} state="empty" empty={{ title: a.health_no_activity }} />;

  const tq = quantumFor(triage.passes, 40);
  const pq = quantumFor(proactive.delivered, 40);
  const jq = quantumFor(jobs.completed + jobs.failed, 40);
  return (
    <Section {...head}>
      <Section level={2} title={a.triage_title} meta={<Legend q={tq} label={a.triage_title} />}>
        <StatStrip tiles={[
          {
            label: a.triage_passes,
            value: <Numeric value={triage.passes} unit="count" />,
            draw: <UnitStrip size="s" rows={2} label={a.triage_passes} segments={apportion([
              { value: triage.drop, tone: 'neutral', glyph: 'soft' }, { value: triage.digest, tone: 'warning' },
              { value: triage.attention, tone: 'error' }, { value: triage.deepDive, tone: 'highlight' },
            ], tq)} />,
          },
          ...tiles([
            { label: a.triage_drop, n: triage.drop, tone: 'neutral', glyph: 'soft' },
            { label: a.triage_digest, n: triage.digest, tone: 'warning' },
            { label: a.triage_attention, n: triage.attention, tone: 'error' },
            { label: a.triage_deep_dive, n: triage.deepDive, tone: 'highlight' },
            { label: a.triage_parse_failures, n: triage.parseFailures, tone: 'error', glyph: 'hollow' },
          ], tq),
        ]} />
      </Section>
      <Section level={2} title={a.proactive_title} meta={<Legend q={pq} label={a.proactive_title} />}>
        <StatStrip tiles={[
          ...tiles([
            { label: a.proactive_delivered, n: proactive.delivered, tone: 'primary', glyph: 'soft' },
            { label: a.proactive_engaged, n: proactive.engaged, tone: 'success' },
            { label: a.proactive_dismissed, n: proactive.dismissed, tone: 'neutral', glyph: 'soft' },
            { label: a.proactive_expired, n: proactive.expired, tone: 'pending', glyph: 'hollow' },
          ], pq),
          {
            label: a.proactive_engaged_rate,
            value: <Numeric value={proactive.delivered > 0 ? proactive.engaged / proactive.delivered : 0} unit="ratio" precision={0} />,
          },
          {
            label: a.proactive_budget,
            value: <><Numeric value={proactive.budgetUsedToday} unit="count" /> / <Numeric value={proactive.budgetCap} unit="count" /></>,
            draw: <UnitStrip size="m" label={a.proactive_budget} segments={[
              { n: proactive.budgetUsedToday, tone: 'primary' },
              { n: Math.max(0, proactive.budgetCap - proactive.budgetUsedToday), glyph: 'empty' },
            ]} />,
          },
        ]} />
      </Section>
      <Section level={2} title={a.jobs_title} meta={<Legend q={jq} label={a.jobs_title} />}>
        <StatStrip tiles={[
          ...tiles([
            { label: a.jobs_completed, n: jobs.completed, tone: 'success' },
            { label: a.jobs_failed, n: jobs.failed, tone: 'error' },
          ], jq),
          { label: a.errors, value: <><Numeric value={errors} unit="count" /> / <Numeric value={turns} unit="count" /></> },
        ]} />
      </Section>
      <AthenaSpendSection />
    </Section>
  );
});
