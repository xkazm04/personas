/**
 * ProjectPipelineView — read-only render of the project pipeline for the
 * Overview tab. Mirrors the onboarding modal's stages so the developer sees
 * the same SDLC pipeline in "view mode": a compact horizontal rail + per-stage
 * summary cards. Presentational — the caller resolves team/connector names.
 */
import { FolderKanban, GitBranch, Users, Code2, GitFork, FlaskConical, Folder } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PipelineRail } from './PipelineRail';
import type { PipelineStage, SourceMode } from './pipelineTypes';

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
}

export function ProjectPipelineView({
  name, path, sourceMode, teamName, connectorName,
  githubUrl, mainBranch, testEnvUrl, testEnvBranch,
}: ProjectPipelineViewProps) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;

  const sourceConfigured = sourceMode === 'team' ? !!teamName : !!connectorName;
  const stages: PipelineStage[] = [
    { id: 'project', label: dp.pipeline_step_project, icon: FolderKanban, status: name ? 'complete' : 'incomplete' },
    { id: 'source', label: dp.pipeline_step_source, icon: GitBranch, status: sourceConfigured ? 'complete' : 'incomplete' },
  ];

  return (
    <div data-testid="project-pipeline-view">
      <div className="max-w-xs mx-auto sm:mx-0 sm:max-w-[260px] mb-4">
        <PipelineRail stages={stages} activeIndex={-1} size="sm" />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
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
      <Icon className="w-3 h-3 text-foreground/40 flex-shrink-0" />
      <span className="typo-caption text-foreground/55 flex-shrink-0">{label}</span>
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
  } catch { /* fall through to raw */ }
  return url;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
