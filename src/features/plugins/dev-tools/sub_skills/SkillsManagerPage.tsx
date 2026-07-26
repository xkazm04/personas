// Skills Manager — Dev Tools' skills module: the workspace library and the
// active project's skills side by side, with the adopt/share Dev-runner
// machinery, transcript-mined usage, memory bindings and the Memory Ledger's
// per-skill context coverage (docs/plans/skill-memory-unification.md).
//
// ── PROTOTYPE SCAFFOLD (/prototype, throwaway) ──────────────────────────────
// Two directional variants behind a tab switcher — pick a winner, then this
// host renders it directly (switcher + loser deleted).
//   · Registry — editorial ledger: symmetric dense columns, quiet row actions
//   · Exchange — trading floor: card rows + an adopt/share gutter between
import { useMemo, useState } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ImproveProvider } from '@/features/teams/sub_factory/passport/improve/ImproveContext';
import { useImproveEngine } from '@/features/teams/sub_factory/passport/improve/useImproveEngine';
import { usePassportData } from '@/features/teams/sub_factory/passport/usePassportData';
import type { SkillCoverageRow, SkillEntry, SkillUsageRow } from '@/api/devTools/devTools';
import { useSystemStore } from '@/stores/systemStore';

import { useSkillsManagerData, type MemoryBinding } from './skillsManagerData';
import { SkillsManagerRegistry } from './SkillsManagerRegistry';
import { SkillsManagerExchange } from './SkillsManagerExchange';
import { SkillContextsModal } from './SkillContextsModal';

type VariantId = 'registry' | 'exchange';

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
  /** Project-side rows only — the host binds the active project id. */
  onSwitchMemory: (skillName: string, next: MemoryBinding) => void;
  onOpenContexts: (skill: string) => void;
}

export default function SkillsManagerPage() {
  // Same provider composition as Mastermind: passports feed the improve
  // engine, which owns the adopt/share Dev-runner ops the workbench reuses.
  const { rawByProject, loading, reload } = usePassportData();
  const improve = useImproveEngine(rawByProject, reload);
  const storeActiveId = useSystemStore((s) => s.activeProjectId);
  const projectIds = useMemo(() => [...rawByProject.keys()], [rawByProject]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const activeId = pickedId ?? (storeActiveId && projectIds.includes(storeActiveId) ? storeActiveId : projectIds[0] ?? null);

  return (
    <ImproveProvider value={improve}>
      {loading && projectIds.length === 0 ? (
        <div className="py-16"><LoadingSpinner label="Loading projects…" /></div>
      ) : (
        <SkillsManagerInner
          key={activeId ?? 'none'}
          activeId={activeId}
          projectOptions={projectIds.map((id) => ({ value: id, label: rawByProject.get(id)?.project.name ?? id }))}
          onPickProject={setPickedId}
        />
      )}
    </ImproveProvider>
  );
}

function SkillsManagerInner({ activeId, projectOptions, onPickProject }: {
  activeId: string | null;
  projectOptions: Array<{ value: string; label: string }>;
  onPickProject: (id: string) => void;
}) {
  const data = useSkillsManagerData(activeId);
  const [variant, setVariant] = useState<VariantId>('registry');
  const [contextsSkill, setContextsSkill] = useState<string | null>(null);

  const projectName = projectOptions.find((o) => o.value === activeId)?.label ?? '';

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
  const Body = variant === 'registry' ? SkillsManagerRegistry : SkillsManagerExchange;

  return (
    <div className="flex flex-col h-full min-h-0 px-4 pb-4" data-testid="skills-manager-page">
      {/* toolbar — project switcher + throwaway A/B */}
      <div className="flex items-center gap-3 py-3 flex-shrink-0">
        <span className="typo-title">Skills</span>
        <div className="w-56">
          <ThemedSelect
            value={activeId ?? ''}
            options={projectOptions}
            onValueChange={onPickProject}
            filterable
            hideSearch
            aria-label="Active project"
          />
        </div>
        <span className="ml-auto">
          <SegmentedTabs
            tabs={[{ id: 'registry', label: 'Registry' }, { id: 'exchange', label: 'Exchange' }]}
            activeTab={variant}
            onTabChange={setVariant}
            variant="segment"
            size="sm"
            fullWidth={false}
            ariaLabel="Skills manager variant"
          />
        </span>
      </div>

      <div className="flex-1 min-h-0">
        <Body
          ws={ws}
          proj={proj}
          totalContexts={data.totalContexts}
          busy={busy}
          projectName={projectName}
          onAdopt={(name) => { void data.wb?.runAdopt(name); }}
          onShare={(name) => { void data.wb?.runShare(name); }}
          onSwitchMemory={(skillName, next) => { void data.switchMemory(skillName, activeId, next); }}
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
