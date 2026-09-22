// The counts panel. Whatever the field is hiding, it says so: the dimmed
// count under council focus and the labels the occupancy pass had to drop are
// printed beside the totals, never swallowed.
import type { RefObject } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import type { Translations } from '@/i18n/en';
import { useTranslation } from '@/i18n/useTranslation';

import { useCouncilStore } from '../../councilStore';
import type { GalaxyFocus, GalaxyLayout } from '../engine/types';

interface Row {
  key: string;
  value: number;
  label: string;
  accent?: boolean;
}

type GalaxyStrings = Translations['council']['galaxy'];

function altitudeRows(layout: GalaxyLayout | null, focus: GalaxyFocus, g: GalaxyStrings): Row[] {
  if (!layout) return [];
  const domain = focus.kind === 'node' ? layout.domains.find((d) => d.slug === focus.domainSlug) : undefined;
  const category = domain?.categories.find((c) => c.id === (focus.kind === 'node' ? focus.categoryId : null));
  const subject = category?.subjects.find((s) => s.slug === (focus.kind === 'node' ? focus.subjectSlug : null));

  if (subject) {
    return [
      { key: 'techniques', value: subject.techniques.length, label: g.counts_techniques },
      { key: 'laws', value: subject.lawCount, label: g.counts_laws },
      { key: 'applications', value: subject.applications, label: g.counts_applications },
    ];
  }
  if (category) {
    return [
      { key: 'subjects', value: category.subjects.length, label: g.counts_subjects },
      { key: 'subcategories', value: category.wedges.length, label: g.counts_subcategories },
    ];
  }
  if (domain) {
    return [
      { key: 'categories', value: domain.categories.length, label: g.counts_categories },
      { key: 'subjects', value: domain.subjectCount, label: g.counts_subjects },
      { key: 'techniques', value: domain.techniqueCount, label: g.counts_techniques },
    ];
  }
  return [
    { key: 'domains', value: layout.domains.length, label: g.counts_domains },
    { key: 'subjects', value: layout.totals.subjects, label: g.counts_subjects },
    { key: 'techniques', value: layout.totals.techniques, label: g.counts_techniques },
  ];
}

/** The panel's box is reserved by the label pass, so it needs a ref out. */
export function CountsPanel({ cardRef }: { cardRef?: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const g = t.council.galaxy;
  const layout = useCouncilStore((s) => s.layout);
  const focus = useCouncilStore((s) => s.focus);
  const counts = useCouncilStore((s) => s.counts);

  const rows = altitudeRows(layout, focus, g);
  if (counts.lit > 0) {
    rows.push({ key: 'lit', value: counts.lit, label: g.counts_lit, accent: true });
    rows.push({ key: 'dimmed', value: counts.dimmed, label: g.counts_dimmed });
  }
  if (counts.labelsHidden > 0) {
    rows.push({ key: 'hidden', value: counts.labelsHidden, label: g.counts_labels_hidden });
  }
  if (rows.length === 0) return null;

  return (
    <div
      ref={cardRef}
      className="pointer-events-none absolute right-4 top-4 z-10 flex max-w-[calc(100%-330px)] flex-wrap justify-end gap-x-3.5 gap-y-1 rounded-card border border-card-border bg-card-bg px-4 py-2.5 shadow-elevation-2"
      data-testid="council-counts"
    >
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col whitespace-nowrap">
          <b className={`typo-heading ${row.accent ? 'text-accent' : 'text-foreground'}`}>
            <Numeric value={row.value} />
          </b>
          <span className="typo-caption uppercase tracking-[0.07em] text-muted-dark">{row.label}</span>
        </div>
      ))}
    </div>
  );
}
