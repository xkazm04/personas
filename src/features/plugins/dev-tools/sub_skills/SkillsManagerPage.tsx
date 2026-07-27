// Skills Manager — Dev Tools' skills module: the workspace library and the
// active project's skills side by side, with the adopt/share Dev-runner
// machinery, transcript-mined usage, memory bindings and the Memory Ledger's
// per-skill context coverage (docs/plans/skill-memory-unification.md).
//
// Project selection = the app-wide ACTIVE PROJECT via the shared
// LifecycleProjectPicker (the same picker every dev-tools/teams page header
// uses), so switching here switches everywhere. Layout: SkillsManagerBoard
// (prototype fusion — Exchange panels × Registry rows).
import { useMemo, useState } from 'react';

import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ImproveProvider } from '@/features/teams/sub_factory/passport/improve/ImproveContext';
import { useImproveEngine } from '@/features/teams/sub_factory/passport/improve/useImproveEngine';
import { usePassportData } from '@/features/teams/sub_factory/passport/usePassportData';
import type { SkillCoverageRow, SkillEntry, SkillUsageRow } from '@/api/devTools/devTools';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { useSkillsManagerData, type MemoryBinding } from './skillsManagerData';
import { SkillsManagerBoard } from './SkillsManagerBoard';
import { SkillContextsModal } from './SkillContextsModal';

/** Workspace-side row model. */
export interface WsRow {
  entry: SkillEntry;
  usage: SkillUsageRow | undefined;
  /** Already installed in the active project (row dims, no adopt action). */
  installed: boolean;
}

/** Project-side row model. */
export interface ProjRow {
  entry: SkillEntry;
  usage: SkillUsageRow | undefined;
  /** The library doesn't have it — the share affordance shows. */
  shareable: boolean;
  coverage: SkillCoverageRow | undefined;
  /** Context-related: declared (`contexts: tracked`) OR evidenced (coverage). */
  tracked: boolean;
}

export interface SkillsManagerVariantProps {
  ws: WsRow[];
  proj: ProjRow[];
  totalContexts: number;
  busy: boolean;
  projectName: string;
  onAdopt: (name: string) => void;
  onShare: (name: string) => void;
  /** Project side — dispatch the installed skill as a background Fleet session
   *  (`/skill args`), the SkillsWorkbench dispatch lane. */
  onUse: (name: string, args: string) => void;
  /** Project-side rows only — the host binds the active project id. */
  onSwitchMemory: (skillName: string, next: MemoryBinding) => void;
  onOpenContexts: (skill: string) => void;
}

export default function SkillsManagerPage() {
  const { t } = useTranslation();
  // Same provider composition as Mastermind: passports feed the improve
  // engine, which owns the adopt/share Dev-runner ops the workbench reuses.
  const { rawByProject, loading, reload } = usePassportData();
  const improve = useImproveEngine(rawByProject, reload);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  return (
    <ImproveProvider value={improve}>
      {loading && rawByProject.size === 0 ? (
        <div className="py-16"><LoadingSpinner label={t.plugins.dev_tools.skills_loading} /></div>
      ) : (
        <SkillsManagerInner key={activeProjectId ?? 'none'} activeId={activeProjectId} />
      )}
    </ImproveProvider>
  );
}

function SkillsManagerInner({ activeId }: { activeId: string | null }) {
  const { t } = useTranslation();
  const projects = useSystemStore((s) => s.projects);
  const data = useSkillsManagerData(activeId);
  const [contextsSkill, setContextsSkill] = useState<string | null>(null);

  const projectName = projects.find((p) => p.id === activeId)?.name ?? '';

  const ws: WsRow[] = useMemo(
    () => data.workspaceSkills.map((entry) => ({
      entry,
      usage: data.usageGlobal.get(entry.name),
      installed: data.installedNames.has(entry.name),
    })),
    [data.workspaceSkills, data.usageGlobal, data.installedNames],
  );

  const shareableNames = useMemo(
    () => new Set((data.wb?.share.items ?? []).map((s) => s.name)),
    [data.wb],
  );
  const proj: ProjRow[] = useMemo(
    () => data.projectSkills.map((entry) => ({
      entry,
      usage: data.usageProject.get(entry.name),
      shareable: shareableNames.has(entry.name),
      coverage: data.coverageBySkill.get(entry.name),
      tracked: entry.contextTracked || data.coverageBySkill.has(entry.name),
    })),
    [data.projectSkills, data.usageProject, shareableNames, data.coverageBySkill],
  );

  const busy = Boolean(data.wb?.managing);

  return (
    <div className="flex flex-col h-full min-h-0 px-4 pb-4" data-testid="skills-manager-page">
      {/* toolbar — the shared active-project picker */}
      <div className="flex items-center gap-3 py-3 flex-shrink-0">
        <span className="typo-title">{t.plugins.dev_tools.skills_title}</span>
        <LifecycleProjectPicker />
      </div>

      <div className="flex-1 min-h-0">
        <SkillsManagerBoard
          ws={ws}
          proj={proj}
          totalContexts={data.totalContexts}
          busy={busy}
          projectName={projectName}
          onAdopt={(name) => { void data.wb?.runAdopt(name); }}
          onShare={(name) => { void data.wb?.runShare(name); }}
          onUse={(name, args) => { void data.wb?.runDispatch(name, args); }}
          onSwitchMemory={(skillName, next) => { if (activeId) void data.switchMemory(skillName, activeId, next); }}
          onOpenContexts={setContextsSkill}
        />
      </div>

      {contextsSkill && activeId && (
        <SkillContextsModal
          projectId={activeId}
          projectName={projectName}
          skill={contextsSkill}
          totalContexts={data.totalContexts}
          onClose={() => setContextsSkill(null)}
        />
      )}
    </div>
  );
}
