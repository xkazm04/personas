/**
 * `kit/overview`: the scale proof for ContextOverview (kit grow-1). 320 contexts in 22 groups at
 * level 1, level 2 for a small group (cards) and a large one (a paged table), and a search. Each
 * block reports what it mounted and how long React took (Profiler, first commit), measured in
 * the page's own browser. `kit/overview-flat` mounts the same 320 contexts as a flat card grid,
 * only to measure the layer ContextOverview replaces; it is not a pattern.
 */
/* eslint-disable custom/no-hardcoded-jsx-text -- specimen fixtures in a harness-only view, not product copy */
import { Profiler, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ContextCard, ContextCards, KitHost, Section, Surface } from '@/features/shared/components/kit';
import { CONTEXT_GROUPS, CONTEXT_TOTAL, OverviewDemo } from './kitContexts';

/** Mounts `children`, then states the DOM it produced and React's first-commit time. */
function Measured({ id, children }: { id: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<number | null>(null);
  const [line, setLine] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      const el = box.current;
      if (!el) return;
      const n = (sel: string) => el.querySelectorAll(sel).length;
      setLine(`mounted: ${n('.k-grp:not(.k-grp--head)')} group rows, ${n('.k-card')} cards, ${n('tbody tr')} table rows, ${el.querySelectorAll('*').length} DOM nodes; React first commit ${first.current?.toFixed(1) ?? '?'} ms`);
    }, 200);
    return () => clearTimeout(t);
  }, []);
  return (
    <Profiler id={id} onRender={(_, phase, actual) => { if (phase === 'mount' && first.current == null) first.current = actual; }}>
      <p className="k-in typo-caption" data-measure={id} style={{ margin: '0 0 8px' }}>{line || 'measuring'}</p>
      <div ref={box}>{children}</div>
    </Profiler>
  );
}

const small = CONTEXT_GROUPS.find((g) => g.count === 8)!;
const large = CONTEXT_GROUPS[0]!;

function KitOverview() {
  return (
    <KitHost compact testId="kit-overview">
      <Surface>
        <Section title="ContextOverview, level 1" eyebrow={`${CONTEXT_TOTAL} contexts in ${CONTEXT_GROUPS.length} groups`} meta="one row per group; a row opens it; the search reaches every context">
          <Measured id="level1"><OverviewDemo /></Measured>
        </Section>
        <Section title="Level 2, a small group" eyebrow={`${small.count} contexts: cards`} meta="cards up to 12; every figure line on the foot, actions top-right">
          <Measured id="small"><OverviewDemo initialOpen={small.id} /></Measured>
        </Section>
        <Section title="Level 2, a large group" eyebrow={`${large.count} contexts: a table`} meta="past 12, a DataTable paged at 20">
          <Measured id="large"><OverviewDemo initialOpen={large.id} /></Measured>
        </Section>
        <Section title="Search at level 1" eyebrow="query: api" meta="matches across every group, at most 50 mounted">
          <Measured id="search"><OverviewDemo initialQuery="api" /></Measured>
        </Section>
      </Surface>
    </KitHost>
  );
}

function KitOverviewFlat() {
  return (
    <KitHost compact testId="kit-overview-flat">
      <Surface>
        <Section title="Flat grid (measurement only)" eyebrow={`${CONTEXT_TOTAL} ContextCards at once`}>
          <Measured id="flat">
            <ContextCards label="All contexts">
              {CONTEXT_GROUPS.flatMap((g) => g.contexts).map((c) => (
                <ContextCard key={c.id} title={c.name} meta={c.group} figures={<span className="typo-data k-regular">{c.kpis} KPIs</span>} onPress={() => {}} />
              ))}
            </ContextCards>
          </Measured>
        </Section>
      </Surface>
    </KitHost>
  );
}

export const KIT_OVERVIEW_MODULES: Record<string, { load: () => Promise<{ default: ComponentType }> }> = {
  'kit/overview': { load: async () => ({ default: KitOverview }) },
  'kit/overview-flat': { load: async () => ({ default: KitOverviewFlat }) },
};
