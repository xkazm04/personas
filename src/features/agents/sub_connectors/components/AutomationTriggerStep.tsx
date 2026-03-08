import {
  Sparkles, Loader2, CheckCircle2, AlertCircle,
  KeyRound, ExternalLink, Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { AutomationPlatform } from '@/lib/bindings/PersonaAutomation';
import type { CredentialMetadata } from '@/lib/types/types';
import type { GitHubRepo, GitHubPermissions, ZapierZap } from '@/api/automations';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import { PLATFORM_CONFIG } from '../libs/automationTypes';

interface AutomationTriggerStepProps {
  description: string;
  setDescription: (v: string) => void;
  platform: AutomationPlatform;
  setPlatform: (v: AutomationPlatform) => void;
  editAutomation: unknown;
  needsCredential: boolean;
  hasPlatformCredential: boolean;
  platformCredentials: CredentialMetadata[];
  platformCredentialId: string | null;
  setPlatformCredentialId: (v: string | null) => void;
  platformConnector: { id: string } | null;
  githubRepos: GitHubRepo[];
  githubPerms: GitHubPermissions | null;
  githubRepo: string | null;
  setGithubRepo: (v: string | null) => void;
  loadingRepos: boolean;
  zapierZaps: ZapierZap[];
  loadingZaps: boolean;
  canDesign: boolean;
  onDesign: () => void;
}

export function AutomationTriggerStep({
  description, setDescription, platform, setPlatform, editAutomation,
  needsCredential, hasPlatformCredential, platformCredentials,
  platformCredentialId, setPlatformCredentialId, platformConnector,
  githubRepos, githubPerms, githubRepo, setGithubRepo, loadingRepos,
  zapierZaps, loadingZaps, canDesign, onDesign,
}: AutomationTriggerStepProps) {
  return (
    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Describe what you want this automation to do. AI will design and deploy the workflow automatically.
      </p>

      <textarea
        placeholder="e.g. Process uploaded CSV files, extract key data, and push results to Google Sheets"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        autoFocus
        className="w-full px-3.5 py-3 text-sm rounded-xl border border-border bg-secondary/20 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canDesign) {
            e.preventDefault();
            onDesign();
          }
        }}
      />

      {/* Platform selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted-foreground">Target platform:</label>
        {editAutomation ? (
          <span className={`inline-flex items-center px-2.5 py-1 text-sm font-medium rounded-xl border ${PLATFORM_CONFIG[platform]?.bg ?? ''} ${PLATFORM_CONFIG[platform]?.color ?? ''}`}>
            {PLATFORM_CONFIG[platform]?.label ?? platform}
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            {(['n8n', 'github_actions', 'zapier', 'custom'] as AutomationPlatform[]).map((p) => (
              <button
                key={p}
                onClick={() => { setPlatform(p); setGithubRepo(null); }}
                className={`px-2.5 py-1 text-sm rounded-xl border transition-colors ${
                  platform === p
                    ? `${PLATFORM_CONFIG[p]?.bg ?? ''} ${PLATFORM_CONFIG[p]?.color ?? ''} border-current/30`
                    : 'border-border/60 text-muted-foreground/60 hover:text-muted-foreground hover:border-border'
                }`}
              >
                {PLATFORM_CONFIG[p]?.label ?? p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Credential gate */}
      {needsCredential && !hasPlatformCredential && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-brand-amber/5 border border-brand-amber/15">
          <KeyRound className="w-4 h-4 text-brand-amber/70 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground/80">{PLATFORM_CONFIG[platform]?.label} credentials required</p>
            <p className="text-sm text-muted-foreground mt-0.5">Add your {PLATFORM_CONFIG[platform]?.label} API key in the Vault to enable direct workflow management and deployment.</p>
            {platformConnector && (
              <button
                onClick={() => { window.dispatchEvent(new CustomEvent('open-vault-connector', { detail: { connectorId: platformConnector.id } })); }}
                className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-sm font-medium rounded-xl bg-brand-amber/15 border border-brand-amber/25 text-foreground/80 hover:bg-brand-amber/25 transition-colors"
              >
                <KeyRound className="w-3 h-3" />
                Add {PLATFORM_CONFIG[platform]?.label} Credentials
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Credential connected */}
      {needsCredential && hasPlatformCredential && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-brand-emerald/5 border border-brand-emerald/15">
          <CheckCircle2 className="w-4 h-4 text-brand-emerald/70 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground/80">
              <span className="font-medium text-brand-emerald">{PLATFORM_CONFIG[platform]?.label} connected</span>
              {' — '}
              <span className="text-muted-foreground">{platformCredentials[0]?.name}</span>
            </p>
          </div>
          {platformCredentials.length > 1 && (
            <ThemedSelect value={platformCredentialId ?? ''} onValueChange={(v) => setPlatformCredentialId(v || null)} wrapperClassName="w-40">
              {platformCredentials.map((c: CredentialMetadata) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </ThemedSelect>
          )}
        </div>
      )}

      {/* GitHub: Repo picker */}
      {platform === 'github_actions' && hasPlatformCredential && (
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
                  options={githubRepos.map((r) => ({ value: r.fullName, label: `${r.fullName}${r.private ? ' (private)' : ''}` }))}
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
      )}

      {/* Zapier: Existing zaps listing */}
      {platform === 'zapier' && hasPlatformCredential && (
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
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground/60">{canDesign ? 'Ctrl+Enter to submit' : ''}</span>
        <button
          onClick={onDesign}
          disabled={!canDesign}
          title={!canDesign ? 'Complete all required fields first' : undefined}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Design with AI
        </button>
      </div>
    </motion.div>
  );
}
