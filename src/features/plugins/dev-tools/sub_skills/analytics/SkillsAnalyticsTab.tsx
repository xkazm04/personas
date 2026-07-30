// Analytics tab — the scanner concepts generalized to skills: coverage
// pipeline (Auto Scan successor), skill performance (Agent Scoreboard
// successor), unified run history (Scan History successor) and the relocated
// deterministic Static Scan lane.
import { useEffect } from 'react';

import { useSystemStore } from '@/stores/systemStore';

import { CoveragePipeline } from './CoveragePipeline';
import { SkillHistoryTable } from './SkillHistoryTable';
import { SkillScoreboard } from './SkillScoreboard';
import { StaticScanCard } from './StaticScanCard';
import { useSkillsAnalytics } from './useSkillsAnalytics';
import type { ProjRow } from '../SkillsManagerPage';

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
      <StaticScanCard projectId={projectId} />
      <CoveragePipeline projectId={projectId} busy={busy} onDispatch={onDispatch} />
    </div>
  );
}
