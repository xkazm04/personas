import { Sparkles, CheckCircle2, KeyRound, ExternalLink } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { AutomationPlatform } from '@/lib/bindings/AutomationPlatform';
import type { CredentialMetadata } from '@/lib/types/types';
import type { GitHubRepo, GitHubPermissions } from '@/api/agents/automations';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { PLATFORM_CONFIG } from '../../libs/automationTypes';
import type { PersonaCapability } from '@/lib/personas/capabilities';
import { DebtText } from '@/i18n/DebtText';
import { GithubRepoPicker } from './AutomationPlatformListings';
import Button from '@/features/shared/components/buttons/Button';


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
  reposFailed: boolean;
  onRetryListings: () => void;
  availableUseCases: PersonaCapability[];
  useCaseId: string | null;
  setUseCaseId: (v: string | null) => void;
  canDesign: boolean;
  onDesign: () => void;
}

export function AutomationTriggerStep({
  description, setDescription, platform, setPlatform, editAutomation,
  needsCredential, hasPlatformCredential, platformCredentials,
  platformCredentialId, setPlatformCredentialId, platformConnector,
  githubRepos, githubPerms, githubRepo, setGithubRepo, loadingRepos,
  reposFailed, onRetryListings,
  availableUseCases, useCaseId, setUseCaseId,
  canDesign, onDesign,
}: AutomationTriggerStepProps) {
  const { t, tx } = useTranslation();
  const selectedCredential = platformCredentials.find((c) => c.id === platformCredentialId) ?? null;
  return (
    <div key="idle" className="animate-fade-slide-in space-y-4">
      <p className="typo-body text-ink-1">
        {t.agents.connectors.auto_describe}
      </p>

      <textarea
        placeholder={t.agents.connectors.auto_describe_placeholder}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        autoFocus
        className="w-full px-3.5 py-3 typo-body rounded-modal border border-hair bg-surface-1 text-ink-1 placeholder:text-ink-3 focus-ring resize-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canDesign) {
            e.preventDefault();
            onDesign();
          }
        }}
      />

      {/* Platform selector */}
      <div className="flex items-center gap-3">
        <label className="typo-body text-ink-1">{t.agents.connectors.auto_target_platform}</label>
        {editAutomation ? (
          <span className={`inline-flex items-center px-2.5 py-1 typo-body rounded-modal border ${PLATFORM_CONFIG[platform]?.bg ?? ''} ${PLATFORM_CONFIG[platform]?.color ?? ''}`}>
            {PLATFORM_CONFIG[platform] ? t.agents.connectors[PLATFORM_CONFIG[platform].labelKey] : platform}
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            {(['n8n', 'github_actions', 'zapier', 'custom'] as AutomationPlatform[]).map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => { setPlatform(p); setGithubRepo(null); }}
                className={`px-2.5 py-1 typo-body rounded-modal border transition-colors ${
                  platform === p
                    ? `${PLATFORM_CONFIG[p]?.bg ?? ''} ${PLATFORM_CONFIG[p]?.color ?? ''} border-current/30`
                    : 'border-hair text-ink-1 hover:text-ink-3 hover:border-hair'
                }`}
              >
                {PLATFORM_CONFIG[p] ? t.agents.connectors[PLATFORM_CONFIG[p].labelKey] : p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Capability scope (Phase C4) — optional; persona-wide by default */}
      {availableUseCases.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="typo-body text-ink-1"><DebtText k="auto_capability_scope_ef5ef511" /></label>
          <ThemedSelect
            wrapperClassName="flex-1"
            value={useCaseId ?? ''}
            onValueChange={(v) => setUseCaseId(v || null)}
          >
            <option value=""><DebtText k="auto_persona_wide_all_capabilities_88066753" /></option>
            {availableUseCases.map((uc) => (
              <option key={uc.id} value={uc.id}>{uc.title}</option>
            ))}
          </ThemedSelect>
        </div>
      )}

      {/* Credential gate */}
      {needsCredential && !hasPlatformCredential && (
        <div className="flex items-start gap-3 p-3.5 rounded-modal bg-brand-amber/5 border border-brand-amber/15">
          <KeyRound className="w-4 h-4 text-brand-amber/70 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="typo-body text-ink-1">{tx(t.agents.connectors.auto_creds_required, { label: PLATFORM_CONFIG[platform] ? t.agents.connectors[PLATFORM_CONFIG[platform].labelKey] : '' })}</p>
            <p className="typo-body text-ink-2 mt-0.5">{tx(t.agents.connectors.auto_add_key_hint, { label: PLATFORM_CONFIG[platform] ? t.agents.connectors[PLATFORM_CONFIG[platform].labelKey] : '' })}</p>
            {platformConnector && (
              <Button
                type="button"
                onClick={() => { window.dispatchEvent(new CustomEvent('open-vault-connector', { detail: { connectorId: platformConnector.id } })); }}
                variant="secondary"
                size="sm"
                className="mt-2"
                icon={<KeyRound className="w-3 h-3" />}
              >
                {tx(t.agents.connectors.auto_add_creds, { label: PLATFORM_CONFIG[platform] ? t.agents.connectors[PLATFORM_CONFIG[platform].labelKey] : '' })}
                <ExternalLink className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Credential connected */}
      {needsCredential && hasPlatformCredential && (
        <div className="flex items-center gap-2.5 p-3 rounded-modal bg-brand-emerald/5 border border-brand-emerald/15">
          <CheckCircle2 className="w-4 h-4 text-brand-emerald/70 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="typo-body text-ink-1">
              <span className="font-medium text-brand-emerald">{tx(t.agents.connectors.auto_connected, { label: PLATFORM_CONFIG[platform] ? t.agents.connectors[PLATFORM_CONFIG[platform].labelKey] : '' })}</span>
              {' -- '}
              {/* The SELECTED credential, not the first one: with two n8n
                  credentials and the second picked, this banner named the
                  first while deploy used the second. Bound, with its own
                  absence arm (entity-picker golden path): a selection whose
                  row is gone must not render as if the first were chosen. */}
              <span className="text-ink-1">{selectedCredential ? selectedCredential.name : t.agents.connectors.auto_none_selected}</span>
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
        <GithubRepoPicker
          githubRepos={githubRepos} githubPerms={githubPerms} githubRepo={githubRepo} setGithubRepo={setGithubRepo}
          loadingRepos={loadingRepos} reposFailed={reposFailed} onRetry={onRetryListings}
        />
      )}

      <div className="flex items-center justify-between">
        <span className="typo-body text-ink-1">{canDesign ? t.agents.connectors.auto_ctrl_enter : ''}</span>
        <Button
          type="button"
          onClick={onDesign}
          disabled={!canDesign}
          tooltip={!canDesign ? t.agents.connectors.auto_complete_fields : undefined}
          variant="secondary"
          size="md"
          icon={<Sparkles className="w-3.5 h-3.5" />}
        >{t.agents.connectors.auto_design_ai}</Button>
      </div>
    </div>
  );
}
