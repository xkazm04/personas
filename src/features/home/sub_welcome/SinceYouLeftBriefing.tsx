import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { OverviewTab } from '@/lib/types/types';
import { ContextCard, ContextCards, KitButton, Section, UnitStrip, quantumFor, type Glyph, type Tone } from '@/features/shared/components/kit';
import { useSinceLeftBriefing, type BriefingLine } from './lib/sinceLeftBriefing';

/**
 * "Since you left": what happened while the user was away (runs, alerts, waiting approvals) as a
 * kit Section of cards, one per kind, each drawing its count as units and opening the Overview
 * surface that holds it. Renders nothing when the delta is trivial or on first run (see
 * useSinceLeftBriefing). Must sit inside a kit surface (WelcomeLayout's KitHost).
 *
 * When the derivation could not run at all - an input the delta needs never loaded - the section
 * says so and offers a retry instead of rendering nothing, because an absence nobody files a bug
 * against is how a briefing stays broken.
 */
export default function SinceYouLeftBriefing() {
  const { visible, lines, dismiss, outcome, retry } = useSinceLeftBriefing();
  const { t, tx } = useTranslation();
  const sl = t.home.since_left;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  if (!visible) return null;

  const goTo = (tab: OverviewTab) => () => {
    setOverviewTab(tab);
    setSidebarSection('overview');
  };

  const cardFor = (line: BriefingLine): {
    title: string; meta?: string; tone: Tone; glyph: Glyph; units: { n: number; tone: Tone; glyph?: Glyph }[]; onPress: () => void;
    /** The same count phrase at another count: what one unit stands for when the quantum is above 1. */
    per: (count: number) => string;
  } => {
    if (line.kind === 'runs') {
      const failed = line.failed ?? 0;
      return {
        title: tx(line.count === 1 ? sl.runs : sl.runs_other, { count: line.count }),
        meta: failed > 0 ? tx(failed === 1 ? sl.failed : sl.failed_other, { count: failed }) : undefined,
        tone: failed > 0 ? 'error' : 'success',
        glyph: 'solid',
        units: [{ n: line.count - failed, tone: 'success' }, { n: failed, tone: 'error' }],
        onPress: goTo('executions'),
        per: (count) => tx(count === 1 ? sl.runs : sl.runs_other, { count }),
      };
    }
    if (line.kind === 'alerts') {
      return {
        title: tx(line.count === 1 ? sl.alerts : sl.alerts_other, { count: line.count }),
        tone: 'warning',
        glyph: 'solid',
        units: [{ n: line.count, tone: 'warning' }],
        // Alerts surface on the Mission Control dashboard since the
        // 2026-08-25 monitoring consolidation (the Health tab is gone).
        onPress: goTo('home'),
        per: (count) => tx(count === 1 ? sl.alerts : sl.alerts_other, { count }),
      };
    }
    // Waiting on you reads info, as setup does elsewhere in the app.
    return {
      title: tx(line.count === 1 ? sl.approvals : sl.approvals_other, { count: line.count }),
      tone: 'info',
      glyph: 'hollow',
      units: [{ n: line.count, tone: 'info', glyph: 'soft' }],
      onPress: goTo('manual-review'),
      per: (count) => tx(count === 1 ? sl.approvals : sl.approvals_other, { count }),
    };
  };

  const notDerived = outcome === 'not-derived' && lines.length === 0;
  return (
    <Section
      title={sl.title}
      actions={<KitButton quiet onClick={dismiss}>{sl.dismiss}</KitButton>}
      state={notDerived ? 'empty' : undefined}
      empty={{
        title: sl.not_derived,
        tone: 'warning',
        testId: 'since-left-not-derived',
        action: <KitButton onClick={retry}>{t.common.retry}</KitButton>,
      }}
    >
      <ContextCards label={sl.title}>
        {lines.map((line) => {
          const c = cardFor(line);
          const total = c.units.reduce((a, u) => a + u.n, 0);
          const q = quantumFor(total, 60);
          return (
            <ContextCard
              key={line.kind}
              title={<span data-testid={`since-left-${line.kind}`}>{c.title}</span>}
              meta={c.meta}
              mark={{ tone: c.tone, glyph: c.glyph, label: c.title }}
              onPress={c.onPress}
              figures={<UnitStrip size="m" label={c.title} legend={q > 1 ? c.per(q) : undefined} segments={c.units.map((u) => ({ ...u, n: u.n / q }))} />}
            />
          );
        })}
      </ContextCards>
    </Section>
  );
}
