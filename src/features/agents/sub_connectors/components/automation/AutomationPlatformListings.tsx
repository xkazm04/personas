import { AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { GitHubRepo, GitHubPermissions } from '@/api/agents/automations';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import Button from '@/features/shared/components/buttons/Button';

/**
 * The platform listings of the trigger step (GitHub repos).
 * A listing that FAILED renders its own line with a retry; it used to collapse
 * to [] and read as an empty account ("No repositories found. Check your token
 * permissions." for a network outage).
 */
function ListingFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="mt-1 flex items-center gap-2 typo-body text-status-error">
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      <Button variant="secondary" size="xs" onClick={onRetry}>{t.common.retry}</Button>
    </div>
  );
}

interface GithubRepoPickerProps {
  githubRepos: GitHubRepo[];
  githubPerms: GitHubPermissions | null;
  githubRepo: string | null;
  setGithubRepo: (v: string | null) => void;
  loadingRepos: boolean;
  reposFailed: boolean;
  onRetry: () => void;
}

export function GithubRepoPicker({
  githubRepos, githubPerms, githubRepo, setGithubRepo, loadingRepos, reposFailed, onRetry,
}: GithubRepoPickerProps) {
  const { t, tx } = useTranslation();
  const missingRepo = !!githubPerms && !githubPerms.hasRepo;
  const missingWorkflow = !!githubPerms && !githubPerms.hasWorkflow;
  const scopes = missingRepo && missingWorkflow
    ? t.agents.connectors.auto_scopes_repo_and_workflow
    : missingRepo ? t.agents.connectors.auto_scope_repo : t.agents.connectors.auto_scope_workflow;
  return (
    <div className="space-y-2">
      {(missingRepo || missingWorkflow) && (
        <div className="flex items-start gap-2.5 p-3 rounded-modal bg-brand-rose/5 border border-brand-rose/15">
          <AlertCircle className="w-4 h-4 text-brand-rose/70 flex-shrink-0 mt-0.5" />
          <div>
            <p className="typo-body text-brand-rose/80">{t.agents.connectors.auto_missing_perms}</p>
            <p className="typo-body text-foreground mt-0.5">
              {tx(t.agents.connectors.auto_github_token_needs, { scopes })}
            </p>
          </div>
        </div>
      )}
      <div>
        <label className="typo-body text-foreground">{t.agents.connectors.auto_repo_required}</label>
        <div className="mt-1.5">
          {loadingRepos ? (
            // Ghost in the select's geometry, delayed so a fast fetch never paints it.
            <div className="h-9 rounded-modal border border-border/60 bg-secondary/30 animate-fade-in" style={{ animationDelay: '120ms' }}>
              <span className="sr-only">{t.agents.connectors.auto_loading_repos}</span>
            </div>
          ) : (
            <ThemedSelect
              filterable
              options={githubRepos.map((r) => ({
                value: r.fullName,
                label: r.private ? tx(t.agents.connectors.auto_repo_private, { name: r.fullName }) : r.fullName,
              }))}
              value={githubRepo ?? ''}
              onValueChange={(v) => setGithubRepo(v || null)}
              placeholder={t.agents.connectors.auto_select_repo}
            />
          )}
        </div>
        {!loadingRepos && reposFailed && (
          <ListingFailed message={t.agents.connectors.auto_repos_load_failed} onRetry={onRetry} />
        )}
        {!loadingRepos && !reposFailed && githubRepos.length === 0 && (
          <p className="mt-1 typo-body text-foreground">{t.agents.connectors.auto_no_repos}</p>
        )}
      </div>
    </div>
  );
}
