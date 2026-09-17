// Analytics tab — the scanner concepts generalized to skills: coverage
// pipeline (Auto Scan successor), skill performance (Agent Scoreboard
// successor), unified run history (Scan History successor) and the relocated
// deterministic Static Scan lane.
import { useEffect, useState } from 'react';

import { listTasks } from '@/api/devTools/devTools';
import type { DevTask } from '@/lib/bindings/DevTask';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { CoveragePipeline } from './CoveragePipeline';
import { DeepScanRecommendations } from './DeepScanRecommendations';
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

  // Ideas + a bounded task page power the preset accept/impl columns.
  // Do not call fetchTasks — that dumps SELECT * into the Run Desk slot.
  const fetchIdeas = useSystemStore((s) => s.fetchIdeas);
  const [tasks, setTasks] = useState<DevTask[]>([]);
  useEffect(() => {
    fetchIdeas(projectId);
    listTasks(projectId, undefined, undefined, { limit: 30 })
      .then(setTasks)
      .catch(silentCatch('skillsAnalytics tasks'));
  }, [projectId, fetchIdeas]);

  return (
    <div className="h-full flex flex-col gap-4 overflow-y-auto min-h-0 pb-4" data-testid="skills-analytics-tab">
      <SkillScoreboard proj={proj} totalContexts={totalContexts} runs={runs} tasks={tasks} onOpenInfo={onOpenInfo} />
      <SkillHistoryTable runs={runs} onRerun={busy ? undefined : onDispatch} onOpenInfo={onOpenInfo} />
      <StaticScanCard projectId={projectId} />
      <CoveragePipeline projectId={projectId} busy={busy} onDispatch={onDispatch} />
      <DeepScanRecommendations projectId={projectId} busy={busy} onDispatch={onDispatch} />
    </div>
  );
}
