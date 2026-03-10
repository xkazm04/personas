import { Zap, Loader2, AlertCircle } from 'lucide-react';
import type { GitHubRepo, GitHubPermissions, ZapierZap } from '@/api/agents/automations';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

interface GitHubRepoPickerProps {
  githubRepos: GitHubRepo[];
  githubPerms: GitHubPermissions | null;
  githubRepo: string | null;
  setGithubRepo: (v: string | null) => void;
  loadingRepos: boolean;
}

export function GitHubRepoPicker({
  githubRepos, githubPerms, githubRepo, setGithubRepo, loadingRepos,
}: GitHubRepoPickerProps) {
  return (
    <div className="space-y-2">
      {githubPerms && (!githubPerms.hasRepo || !githubPerms.hasWorkflow) && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-brand-rose/5 border border-brand-rose/15">
          <AlertCircle className="w-4 h-4 text-brand-rose/70 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-brand-rose/80">Missing GitHub permissions</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Your token needs{!githubPerms.hasRepo ? " 'repo'" : ''}{!githubPerms.hasRepo && !githubPerms.hasWorkflow ? ' and' : ''}{!githubPerms.hasWorkflow ? " 'workflow'" : ''} scope{(!githubPerms.hasRepo && !githubPerms.hasWorkflow) ? 's' : ''}.
              Update your token at github.com/settings/tokens.
            </p>
          </div>
        </div>
      )}

      <div>
        <label className="text-sm font-medium text-muted-foreground">Repository (required)</label>
        <div className="mt-1.5">
          {loadingRepos ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading repositories...
            </div>
          ) : (
            <ThemedSelect
              filterable
              options={githubRepos.map((r) => ({
                value: r.fullName,
                label: `${r.fullName}${r.private ? ' (private)' : ''}`,
              }))}
              value={githubRepo ?? ''}
              onValueChange={(v) => setGithubRepo(v || null)}
              placeholder="Select a repository..."
            />
          )}
        </div>
        {githubRepos.length === 0 && !loadingRepos && (
          <p className="mt-1 text-sm text-muted-foreground/60">No repositories found. Check your token permissions.</p>
        )}
      </div>
    </div>
  );
}

interface ZapierZapsListProps {
  zapierZaps: ZapierZap[];
  loadingZaps: boolean;
}

export function ZapierZapsList({ zapierZaps, loadingZaps }: ZapierZapsListProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground">Your existing Zaps</label>
      {loadingZaps ? (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading your Zaps...
        </div>
      ) : zapierZaps.length > 0 ? (
        <div className="max-h-36 overflow-y-auto rounded-xl border border-border/60 divide-y divide-border/40">
          {zapierZaps.map((zap) => (
            <div key={zap.id} className="flex items-center gap-2.5 px-3 py-2">
              <Zap className={`w-3.5 h-3.5 flex-shrink-0 ${zap.status === 'on' ? 'text-brand-amber' : 'text-muted-foreground/40'}`} />
              <span className="text-sm text-foreground/80 truncate flex-1">{zap.title}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-lg ${
                zap.status === 'on' ? 'bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/20' :
                zap.status === 'off' ? 'bg-secondary/60 text-muted-foreground border border-border/40' :
                'bg-brand-amber/10 text-brand-amber border border-brand-amber/20'
              }`}>{zap.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/60 px-1">No existing Zaps found. A new Zap will be created during deployment.</p>
      )}
      <p className="text-xs text-muted-foreground/50 px-1">
        AI will design a new Zap with a catch hook for your agent. Existing Zaps are shown for reference.
      </p>
    </div>
  );
}
