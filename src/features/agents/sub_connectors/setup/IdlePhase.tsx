import { Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import type { AutomationPlatform } from '@/lib/bindings/PersonaAutomation';
import type { CredentialMetadata } from '@/lib/types/types';
import type { GitHubRepo, GitHubPermissions, ZapierZap } from '@/api/agents/automations';
import { PLATFORM_CONFIG } from '../libs/automationTypes';
import { CredentialStatus } from './CredentialStatus';
import { GitHubRepoPicker, ZapierZapsList } from './PlatformPickers';

interface IdlePhaseProps {
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
  handleDesign: () => void;
}

export function IdlePhase({
  description, setDescription,
  platform, setPlatform,
  editAutomation,
  needsCredential, hasPlatformCredential,
  platformCredentials, platformCredentialId, setPlatformCredentialId,
  platformConnector,
  githubRepos, githubPerms, githubRepo, setGithubRepo, loadingRepos,
  zapierZaps, loadingZaps,
  canDesign, handleDesign,
}: IdlePhaseProps) {
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
            handleDesign();
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

      <CredentialStatus
        platform={platform}
        needsCredential={needsCredential}
        hasPlatformCredential={hasPlatformCredential}
        platformCredentials={platformCredentials}
        platformCredentialId={platformCredentialId}
        setPlatformCredentialId={setPlatformCredentialId}
        platformConnector={platformConnector}
      />

      {platform === 'github_actions' && hasPlatformCredential && (
        <GitHubRepoPicker
          githubRepos={githubRepos}
          githubPerms={githubPerms}
          githubRepo={githubRepo}
          setGithubRepo={setGithubRepo}
          loadingRepos={loadingRepos}
        />
      )}

      {platform === 'zapier' && hasPlatformCredential && (
        <ZapierZapsList zapierZaps={zapierZaps} loadingZaps={loadingZaps} />
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground/60">
          {canDesign ? 'Ctrl+Enter to submit' : ''}
        </span>
        <button
          onClick={handleDesign}
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
