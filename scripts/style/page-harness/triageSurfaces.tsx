/**
 * Module 2 (`plugins/dev-tools/sub_triage`): the triage instruments have no page
 * of their own. The app mounts them in Overview -> Manual Review -> Backlog, so
 * the host page here is `BacklogPanel` inside the same ContentBox/ContentBody
 * the Manual Review list gives it, on the synthetic tape `sub_triage`.
 *
 * `.../leaves` mounts the states the page cannot reach without a click (the
 * rules disclosure open, its create form, the level-filter popover, an evidence
 * popover, every origin badge and verdict chip) on the same tape. The clicks are
 * made once, after mount, through the controls' own buttons.
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

const PROJECT = 'proj-triage';

async function prepareTriage(): Promise<void> {
  useSystemStore.setState({ sidebarSection: 'overview' });
  const sys = useSystemStore.getState();
  // State the app already holds on this route: the project list, the active
  // project, and the idea history other Dev Tools pages loaded.
  await sys.fetchProjects();
  useSystemStore.setState({ activeProjectId: PROJECT });
  await sys.fetchIdeas(PROJECT);
  // A sweep earlier in the session skipped three sensors (two can be wired from here).
  const { recordSweep } = await import('@/features/plugins/dev-tools/sub_triage/findings/lastSweep');
  recordSweep(PROJECT, ['llm', 'sentry', 'docs']);
}

async function backlogHost(): Promise<{ default: ComponentType }> {
  const [{ BacklogPanel }, { useBacklogQueue }, { ContentBox, ContentBody }] = await Promise.all([
    import('@/features/overview/sub_manual-review/components/backlog/BacklogPanel'),
    import('@/features/overview/sub_manual-review/components/backlog/useBacklogQueue'),
    import('@/features/shared/components/layout/ContentLayout'),
  ]);
  return {
    default: function BacklogHost() {
      const queue = useBacklogQueue();
      return (
        <ContentBox>
          <ContentBody flex noPadding>
            <BacklogPanel queue={queue} />
          </ContentBody>
        </ContentBox>
      );
    },
  };
}

/** Clicks each selector once, in order, a frame apart. Guarded so StrictMode's double effect clicks once. */
function Driven({ clicks, children }: { clicks: string[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || root.dataset.driven) return;
    root.dataset.driven = '1';
    let i = 0;
    const step = () => {
      const sel = clicks[i++];
      if (!sel) return;
      root.querySelector<HTMLElement>(sel)?.click();
      requestAnimationFrame(() => setTimeout(step, 60));
    };
    setTimeout(step, 60);
  }, [clicks]);
  return <div ref={ref}>{children}</div>;
}

function Leaf({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="typo-code text-foreground">{caption}</div>
      {children}
    </section>
  );
}

async function leaves(): Promise<{ default: ComponentType }> {
  const [{ EffortRiskFilter }, { TriageRulesPanel }, { FindingBadge, VerdictChip }] = await Promise.all([
    import('@/features/plugins/dev-tools/sub_triage/EffortRiskFilter'),
    import('@/features/plugins/dev-tools/sub_triage/TriageRulesPanel'),
    import('@/features/plugins/dev-tools/sub_triage/findings/FindingBadge'),
  ]);
  const origins = [
    'standards_finding', 'passport_gap', 'llm_cost', 'sentry_spike', 'kpi_offtrack', 'skill_dormant',
    'doc_rot', 'kpi_sim', 'memory_disputed', 'workspace_practice', 'scan_sweep',
  ];
  const evidence = JSON.stringify({ count: 142, users: 17, shortId: 'PERSONAS-4K', firstSeenDays: 3 });

  function Filter() {
    const [effort, setEffort] = useState<[number, number]>([1, 3]);
    const [risk, setRisk] = useState<[number, number]>([7, 10]);
    return (
      <div className="w-64 p-3 rounded-card border border-primary/15 bg-background shadow-elevation-3">
        <EffortRiskFilter effortRange={effort} riskRange={risk} onEffortChange={setEffort} onRiskChange={setRisk} />
      </div>
    );
  }

  return {
    default: function TriageLeaves() {
      return (
        <div className="flex flex-col gap-6 p-6 overflow-y-auto">
          <Leaf caption="TriageRulesPanel: open, rules + suggestions, after Run">
            <Driven clicks={['[data-testid="triage-rules-toggle"]', '[data-testid="triage-rules-run"]']}>
              <TriageRulesPanel projectId={PROJECT} />
            </Driven>
          </Leaf>
          <Leaf caption="TriageRulesPanel: create form">
            <Driven clicks={['[data-testid="triage-rules-toggle"]', '[data-testid="triage-rules-new"]']}>
              <TriageRulesPanel projectId={PROJECT} />
            </Driven>
          </Leaf>
          <div className="flex gap-6 items-start">
            <Leaf caption="EffortRiskFilter: quick wins + risky">
              <Filter />
            </Leaf>
            <Leaf caption="FindingBadge: evidence open">
              <Driven clicks={['button[aria-expanded="false"]']}>
                <div className="pb-40">
                  <FindingBadge origin="sentry_spike" evidence={evidence} />
                </div>
              </Driven>
            </Leaf>
          </div>
          <Leaf caption="FindingBadge: every origin">
            <div className="flex flex-wrap gap-2">
              {origins.map((o) => <FindingBadge key={o} origin={o} evidence={o === 'llm_cost' ? evidence : null} />)}
            </div>
          </Leaf>
          <Leaf caption="VerdictChip: cleared, moved, unchanged, regressed">
            <div className="flex flex-wrap gap-2">
              {['cleared', 'moved', 'unchanged', 'regressed'].map((v) => <VerdictChip key={v} verifyState={v} />)}
            </div>
          </Leaf>
        </div>
      );
    },
  };
}

export const TRIAGE_MODULES: Record<string, HarnessModule> = {
  'plugins/dev-tools/sub_triage': { load: backlogHost, prepare: prepareTriage },
  'plugins/dev-tools/sub_triage/leaves': { load: leaves, prepare: prepareTriage },
};
