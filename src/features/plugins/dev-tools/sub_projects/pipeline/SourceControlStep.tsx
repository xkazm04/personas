/**
 * SourceControlStep — stage 2 editor of the project pipeline.
 *
 * A Team / Standalone switch picks the binding mode:
 *   - Team:       a PersonaTeam owns delivery (team selector mandatory).
 *   - Standalone: a GitHub connector authorises PR / source-control ops
 *                 (connector mandatory; it also drives the repo dropdown).
 * Repo + main branch + living-test-environment fields are common to both.
 * The folded-in team binding replaces the old "Workspace" section.
 */
import { Users, GitBranch, Code2, GitFork } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { GitHubRepoSelector } from '../GitHubRepoSelector';
import type { SourceMode } from './pipelineTypes';

interface SourceControlStepProps {
  sourceMode: SourceMode;
  onModeChange: (mode: SourceMode) => void;
  // Team binding
  teams: { id: string; name: string }[];
  teamId: string | null;
  onTeamChange: (id: string | null) => void;
  // Standalone connector
  githubCreds: { id: string; name: string }[];
  prCredentialId: string | null;
  onCredChange: (id: string | null) => void;
  // Shared source-control fields
  githubUrl: string;
  onGithubUrlChange: (url: string) => void;
  mainBranch: string;
  onMainBranchChange: (branch: string) => void;
  testEnvUrl: string;
  onTestEnvUrlChange: (url: string) => void;
  testEnvBranch: string;
  onTestEnvBranchChange: (branch: string) => void;
}

export function SourceControlStep({
  sourceMode, onModeChange,
  teams, teamId, onTeamChange,
  githubCreds, prCredentialId, onCredChange,
  githubUrl, onGithubUrlChange,
  mainBranch, onMainBranchChange,
  testEnvUrl, onTestEnvUrlChange,
  testEnvBranch, onTestEnvBranchChange,
}: SourceControlStepProps) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;

  // In standalone mode the chosen connector drives which repos the picker
  // lists; in team mode the picker auto-discovers any usable GitHub PAT.
  const repoCredentialId = sourceMode === 'standalone' ? prCredentialId : null;

  return (
    <div className="space-y-5">
      {/* Mode switch — Team OR Standalone */}
      <div className="grid grid-cols-2 gap-2">
        <ModeButton
          active={sourceMode === 'team'}
          icon={Users}
          label={dp.source_mode_team}
          hint={dp.source_mode_team_hint}
          onClick={() => onModeChange('team')}
        />
        <ModeButton
          active={sourceMode === 'standalone'}
          icon={GitBranch}
          label={dp.source_mode_standalone}
          hint={dp.source_mode_standalone_hint}
          onClick={() => onModeChange('standalone')}
        />
      </div>

      {/* Mandatory selector for the chosen mode */}
      {sourceMode === 'team' ? (
        <div>
          <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
            {dp.team_binding_label}
            <span className="typo-caption text-amber-400/80 font-normal">({dp.field_required})</span>
          </label>
          <ThemedSelect value={teamId ?? ''} onValueChange={(v) => onTeamChange(v || null)}>
            <option value="">{dp.team_binding_none}</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </ThemedSelect>
          {teams.length === 0 && (
            <p className="typo-caption text-foreground mt-1">{dp.team_binding_empty}</p>
          )}
        </div>
      ) : (
        <div data-testid="project-github-connector">
          <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
            {dp.github_connector_label}
            <span className="typo-caption text-amber-400/80 font-normal">({dp.field_required})</span>
          </label>
          <ThemedSelect value={prCredentialId ?? ''} onValueChange={(v) => onCredChange(v || null)}>
            <option value="">{dp.team_binding_none}</option>
            {githubCreds.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </ThemedSelect>
        </div>
      )}

      {/* Repository — common to both modes */}
      <GitHubRepoSelector value={githubUrl} onChange={onGithubUrlChange} credentialId={repoCredentialId} />
      {sourceMode === 'standalone' && prCredentialId && (
        <p className="typo-caption text-foreground -mt-2 flex items-center gap-1.5">
          <Code2 className="w-3 h-3 text-amber-400/70 flex-shrink-0" />
          {dp.repos_from_connector}
        </p>
      )}

      {/* Main branch */}
      <div>
        <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
          <GitFork className="w-3 h-3 text-amber-400/70" />
          {dp.main_branch_label}
          <span className="typo-caption text-foreground font-normal">({dp.team_binding_optional})</span>
        </label>
        <input
          value={mainBranch}
          onChange={(e) => onMainBranchChange(e.target.value)}
          placeholder={dp.main_branch_placeholder}
          className="w-full px-3 py-2.5 text-md bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring"
        />
      </div>

      {/* Living test environment — url + branch, both optional */}
      <div className="grid md:grid-cols-2 gap-3 items-start">
        <div>
          <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
            {dp.test_env_url}
            <span className="typo-caption text-foreground font-normal">({dp.team_binding_optional})</span>
          </label>
          <input
            value={testEnvUrl}
            onChange={(e) => onTestEnvUrlChange(e.target.value)}
            placeholder={dp.test_env_url_placeholder}
            className="w-full px-3 py-2.5 text-md bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring"
          />
        </div>
        <div>
          <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
            {dp.test_env_branch}
            <span className="typo-caption text-foreground font-normal">({dp.team_binding_optional})</span>
          </label>
          <input
            value={testEnvBranch}
            onChange={(e) => onTestEnvBranchChange(e.target.value)}
            placeholder={dp.test_env_branch_placeholder}
            className="w-full px-3 py-2.5 text-md bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring"
          />
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active, icon: Icon, label, hint, onClick,
}: {
  active: boolean;
  icon: typeof Users;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-start gap-1 px-3 py-2.5 text-left border rounded-input transition-colors ${
        active
          ? 'bg-amber-500/8 border-amber-500/30'
          : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
      }`}
    >
      <span className="flex items-center gap-1.5 typo-caption font-medium text-foreground">
        <Icon className={`w-3.5 h-3.5 ${active ? 'text-amber-400' : 'text-foreground/60'}`} />
        {label}
      </span>
      <span className="typo-caption text-foreground leading-snug">{hint}</span>
    </button>
  );
}
