/**
 * ProjectPipelineView — read-only render of the project pipeline for the
 * Overview tab. Mirrors the onboarding modal's stages so the developer sees
 * the same SDLC pipeline in "view mode": a compact horizontal rail + per-stage
 * summary cards. Presentational — the caller resolves team/connector names.
 */
import { FolderKanban, GitBranch, Users, Code2, GitFork, FlaskConical, Folder, ShieldCheck, GitMerge } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PipelineRail } from './PipelineRail';
import type { PipelineStage, SourceMode } from './pipelineTypes';
import { parseStandards, resolveBranchName } from './standardsConfig';
import { silentCatch } from '@/lib/silentCatch';

interface ProjectPipelineViewProps {
  name: string;
  path: string;
  sourceMode: SourceMode;
  /** Resolved team display name (team mode). */
  teamName?: string | null;
  /** Resolved connector display name (standalone mode). */
  connectorName?: string | null;
  githubUrl?: string;
  mainBranch?: string;
  testEnvUrl?: string;
  testEnvBranch?: string;
  /** Standards & branching policy JSON (Pipeline Stage 3). */
  standardsConfig?: string;
}

export function ProjectPipelineView({
  name, path, sourceMode, teamName, connectorName,
  githubUrl, mainBranch, testEnvUrl, testEnvBranch, standardsConfig,
}: ProjectPipelineViewProps) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;

  const sourceConfigured = sourceMode === 'team' ? !!teamName : !!connectorName;
  const std = parseStandards(standardsConfig);
  const gates = [
    std.precommit.lint && dp.standards_lint,
    std.precommit.docs_required && dp.standards_docs,
    std.precommit.code_quality && dp.standards_quality,
  ].filter(Boolean).join(' · ');
  const prBaseName = resolveBranchName(std.branching.pr_base, mainBranch ?? '', testEnvBranch ?? '');
  const automergeText = std.branching.automerge.enabled
    ? `${dp.standards_automerge_on} ${resolveBranchName(std.branching.automerge.target, mainBranch ?? '', testEnvBranch ?? '')}`
    : dp.standards_automerge_off;

  const stages: PipelineStage[] = [
    { id: 'project', label: dp.pipeline_step_project, icon: FolderKanban, status: name ? 'complete' : 'incomplete' },
    { id: 'source', label: dp.pipeline_step_source, icon: GitBranch, status: sourceConfigured ? 'complete' : 'incomplete' },
    { id: 'standards', label: dp.pipeline_step_standards, icon: ShieldCheck, status: standardsConfig ? 'complete' : 'incomplete' },
  ];

  return (
    <div data-testid="project-pipeline-view">
      <div className="max-w-xs mx-auto sm:mx-0 sm:max-w-[360px] mb-4">
        <PipelineRail stages={stages} activeIndex={-1} size="sm" />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Stage 1 — Project */}
        <StageCard icon={FolderKanban} label={dp.pipeline_step_project}>
          <KvRow icon={Folder} label={dp.project_folder} value={path} mono />
          <KvRow icon={FolderKanban} label={dp.project_name} value={name} />
        </StageCard>

        {/* Stage 2 — Source control */}
        <StageCard icon={GitBranch} label={dp.pipeline_step_source}>
          {sourceMode === 'team' ? (
            <KvRow icon={Users} label={dp.source_mode_team} value={teamName ?? null} />
          ) : (
            <KvRow icon={Code2} label={dp.source_mode_standalone} value={connectorName ?? null} />
          )}
          <KvRow icon={GitBranch} label={dp.github_repository} value={shortRepo(githubUrl)} mono />
          <KvRow icon={GitFork} label={dp.main_branch_label} value={mainBranch || null} mono />
          <KvRow
            icon={FlaskConical}
            label={dp.test_env_url}
            value={testEnvUrl ? `${stripScheme(testEnvUrl)}${testEnvBranch ? ` · ${testEnvBranch}` : ''}` : null}
            mono
          />
        </StageCard>

        {/* Stage 3 — Standards */}
        <StageCard icon={ShieldCheck} label={dp.pipeline_step_standards}>
          <KvRow icon={ShieldCheck} label={dp.standards_precommit_heading} value={gates || null} />
          <KvRow icon={GitBranch} label={dp.standards_pr_base} value={prBaseName} mono />
          <KvRow icon={GitMerge} label={dp.standards_automerge} value={automergeText} />
        </StageCard>
      </div>
    </div>
  );
}

function StageCard({ icon: Icon, label, children }: { icon: typeof FolderKanban; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-primary/10 bg-card/30 p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-6 h-6 rounded-interactive bg-amber-500/12 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5 text-amber-400" />
        </span>
        <span className="typo-card-label">{label}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KvRow({
  icon: Icon, label, value, mono,
}: {
  icon: typeof Folder;
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="w-3 h-3 text-foreground flex-shrink-0" />
      <span className="typo-caption text-foreground flex-shrink-0">{label}</span>
      <span
        className={`typo-caption truncate ml-auto text-right min-w-0 ${value ? 'text-foreground' : 'text-foreground/35 italic'} ${mono && value ? 'font-mono' : ''}`}
        title={value ?? undefined}
      >
        {value ?? t.plugins.dev_projects.pipeline_not_set}
      </span>
    </div>
  );
}

/** owner/repo from a GitHub URL, else the raw value. */
function shortRepo(url?: string): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[parts.length - 1]!.replace(/\.git$/, '')}`;
  } catch (err) {
    /* fall through to raw */
    silentCatch('features/plugins/dev-tools/sub_projects/pipeline/ProjectPipelineView:shortRepo')(err);
  }
  return url;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
