// Analytics tab — the scanner concepts generalized to skills: coverage
// pipeline (Auto Scan successor), skill performance (Agent Scoreboard
// successor), unified run history (Scan History successor) and the relocated
// deterministic Static Scan lane.
//
// Load discipline (loading-pattern v2): only the first-visible pair —
// Scoreboard + History — parses and fetches on tab mount. The three panels
// below the fold are their own lazy chunks behind `DeferredPanel`, mounting
// (and firing their fetches) on scroll-into-view or first idle, so the tab's
// cold load stays flat as skill use grows.
import { useEffect } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';

import { useSystemStore } from '@/stores/systemStore';

import { DeferredPanel } from './DeferredPanel';
import { SkillHistoryTable } from './SkillHistoryTable';
import { SkillScoreboard } from './SkillScoreboard';
import { useSkillsAnalytics } from './useSkillsAnalytics';
import type { ProjRow } from '../SkillsManagerPage';

const StaticScanCard = lazyRetry(() => import('./StaticScanCard').then((m) => ({ default: m.StaticScanCard })));
const CoveragePipeline = lazyRetry(() => import('./CoveragePipeline').then((m) => ({ default: m.CoveragePipeline })));
const DeepScanRecommendations = lazyRetry(() => import('./DeepScanRecommendations').then((m) => ({ default: m.DeepScanRecommendations })));

export function SkillsAnalyticsTab({ projectId, proj, totalContexts, busy, onDispatch, onOpenInfo }: {
  projectId: string;
  proj: ProjRow[];
  totalContexts: number;
  busy: boolean;
  /** Fleet-dispatch a skill with args (context name folded by callers). */
  onDispatch: (skill: string, args: string) => void;
  /** Skill-name click → the shared metadata modal. */
  onOpenInfo: (skill: string) => void;
}) {
  const { runs } = useSkillsAnalytics(projectId);

  // Ideas + tasks power the preset accept/impl columns (legacy agent linkage).
  const fetchIdeas = useSystemStore((s) => s.fetchIdeas);
  const fetchTasks = useSystemStore((s) => s.fetchTasks);
  useEffect(() => {
    fetchIdeas(projectId);
    fetchTasks(projectId);
  }, [projectId, fetchIdeas, fetchTasks]);

  return (
    <div className="h-full flex flex-col gap-4 overflow-y-auto min-h-0 pb-4" data-testid="skills-analytics-tab">
      <SkillScoreboard proj={proj} totalContexts={totalContexts} runs={runs} onOpenInfo={onOpenInfo} />
      <SkillHistoryTable runs={runs} onRerun={busy ? undefined : onDispatch} onOpenInfo={onOpenInfo} />
      {/* Single-row lane — ghost sized to its one-line chrome. */}
      <DeferredPanel minHeightClass="min-h-12">
        <StaticScanCard projectId={projectId} />
      </DeferredPanel>
      <DeferredPanel minHeightClass="min-h-24">
        <CoveragePipeline projectId={projectId} busy={busy} onDispatch={onDispatch} />
      </DeferredPanel>
      {/* Renders null with no open escalations — bare placeholder, no ghost. */}
      <DeferredPanel bare>
        <DeepScanRecommendations projectId={projectId} busy={busy} onDispatch={onDispatch} />
      </DeferredPanel>
    </div>
  );
}
