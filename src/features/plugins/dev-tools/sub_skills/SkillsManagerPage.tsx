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
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { useSkillsManagerData, type MemoryBinding } from './skillsManagerData';
import { SkillsManagerBoard } from './SkillsManagerBoard';
import { SkillContextsModal } from './SkillContextsModal';
import type { UseSkillChoice } from './UseSkillDialog';

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
  /** Active project id — the Use dialog needs it to fetch contexts. */
  projectId: string | null;
  onAdopt: (name: string) => void;
  onShare: (name: string) => void;
  /** Project side — run the installed skill with the operator's dispatch-target
   *  + context choice (see UseSkillChoice). */
  onUse: (name: string, choice: UseSkillChoice) => void;
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
  const addToast = useToastStore((s) => s.addToast);
  const { copy } = useCopyToClipboard();

  // Route the operator's Use choice. Context term is folded into the args as a
  // trailing positional (a "preset terminal input"); "all" runs one dispatch
  // per context. Fleet → wb.runDispatch; CMD → copy the command(s) so the
  // operator runs them in their own external terminal (outside Personas).
  const runUse = (name: string, choice: UseSkillChoice) => {
    const argSets = choice.contexts.length
      ? choice.contexts.map((c) => [choice.args, c].filter(Boolean).join(' '))
      : [choice.args];
    if (choice.target === 'cmd') {
      const cmd = argSets.map((a) => `claude "${skillCommand(name, a)}"`).join(' && ');
      copy(cmd);
      addToast(t.plugins.dev_tools.skills_use_cmd_copied, 'success');
      return;
    }
    for (const a of argSets) void data.wb?.runDispatch(name, a);
  };

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
          projectId={activeId}
          onAdopt={(name) => { void data.wb?.runAdopt(name); }}
          onShare={(name) => { void data.wb?.runShare(name); }}
          onUse={runUse}
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
