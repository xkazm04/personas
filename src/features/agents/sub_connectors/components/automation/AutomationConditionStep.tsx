import {
  CheckCircle2, AlertCircle, ChevronDown, Pencil,
  Rocket, GitBranch, Zap,
} from 'lucide-react';
import type { AutomationPlatform, AutomationFallbackMode } from '@/lib/bindings/PersonaAutomation';
import type { CredentialMetadata } from '@/lib/types/types';
import { PLATFORM_CONFIG } from '../../libs/automationTypes';
import { FALLBACK_OPTIONS } from '../../libs/useAutomationSetup';
import { useTranslation } from '@/i18n/useTranslation';

interface DesignResult {
  platform_reasoning?: string;
  setup_steps?: string[];
  handles_connectors?: string[];
  workflow_definition?: Record<string, unknown>;
}

interface AutomationConditionStepProps {
  designResult: DesignResult;
  name: string;
  setName: (v: string) => void;
  platform: AutomationPlatform;
  githubRepo: string | null;
  hasPlatformCredential: boolean;
  platformCredentials: CredentialMetadata[];
  platformCredentialId: string | null;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  inputSchema: string;
  setInputSchema: (v: string) => void;
  fallbackMode: AutomationFallbackMode;
  setFallbackMode: (v: AutomationFallbackMode) => void;
  timeoutSecs: number;
  setTimeoutSecs: (v: number) => void;
  deployError: string | null;
}

export function AutomationConditionStep({
  designResult, name, setName, platform, githubRepo,
  hasPlatformCredential, platformCredentials, platformCredentialId,
  showAdvanced, setShowAdvanced, inputSchema, setInputSchema,
  fallbackMode, setFallbackMode, timeoutSecs, setTimeoutSecs, deployError,
}: AutomationConditionStepProps) {
  const { t } = useTranslation();
  return (
    <div key="preview" className="animate-fade-slide-in space-y-6">
      {designResult.platform_reasoning && (
        <div className="px-3.5 py-2.5 rounded-modal bg-accent/5 border border-accent/15">
          <p className="typo-body text-foreground">
            <span className="font-medium text-accent">{t.agents.connectors.auto_ai_recommendation}</span>{' '}
            {designResult.platform_reasoning}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="typo-body font-medium text-foreground uppercase tracking-wider">{t.agents.connectors.auto_name_label}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full mt-1.5 px-3 py-2 typo-body rounded-modal border border-border bg-secondary/20 text-foreground focus-ring" />
          </div>
          <div>
            <label className="typo-body font-medium text-foreground uppercase tracking-wider">{t.agents.connectors.auto_platform_label}</label>
            <div className="mt-1.5">
              <span className={`inline-flex items-center px-2.5 py-1 typo-body font-medium rounded-modal border ${PLATFORM_CONFIG[platform]?.bg ?? ''} ${PLATFORM_CONFIG[platform]?.color ?? ''}`}>
                {PLATFORM_CONFIG[platform]?.label ?? platform}
              </span>
            </div>
          </div>
          {platform === 'n8n' && (
            <div className="px-3 py-2.5 rounded-modal bg-brand-amber/5 border border-brand-amber/15">
              <p className="typo-body text-foreground"><Rocket className="w-3.5 h-3.5 inline mr-1 text-brand-amber" />{t.agents.connectors.auto_n8n_hint}</p>
            </div>
          )}
          {platform === 'github_actions' && githubRepo && (
            <div className="px-3 py-2.5 rounded-modal bg-primary/5 border border-primary/20">
              <p className="typo-body text-foreground"><GitBranch className="w-3.5 h-3.5 inline mr-1 text-primary" />Repository dispatch configured for <span className="font-medium">{githubRepo}</span></p>
              {designResult.workflow_definition && !!(designResult.workflow_definition as Record<string, unknown>).event_type && (
                <p className="typo-body text-foreground mt-1">Event type: <code className="px-1 py-0.5 rounded bg-secondary/40 typo-body">{String((designResult.workflow_definition as Record<string, unknown>).event_type)}</code></p>
              )}
            </div>
          )}
          {platform === 'zapier' && (
            <div className="px-3 py-2.5 rounded-modal bg-brand-amber/5 border border-brand-amber/15">
              <p className="typo-body text-foreground"><Zap className="w-3.5 h-3.5 inline mr-1 text-brand-amber" />{t.agents.connectors.auto_zapier_hint}</p>
            </div>
          )}
          {platform === 'custom' && (
            <div className="px-3 py-2.5 rounded-modal bg-secondary/20 border border-border/40">
              <p className="typo-body text-foreground">{t.agents.connectors.auto_custom_hint}</p>
            </div>
          )}
          <div>
            <label className="typo-body font-medium text-foreground uppercase tracking-wider">{t.agents.connectors.auto_credential_label}</label>
            {hasPlatformCredential ? (
              <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-modal bg-brand-emerald/5 border border-brand-emerald/15">
                <CheckCircle2 className="w-3.5 h-3.5 text-brand-emerald/70 flex-shrink-0" />
                <span className="typo-body text-foreground">{platformCredentials.find((c) => c.id === platformCredentialId)?.name ?? platformCredentials[0]?.name}</span>
              </div>
            ) : (
              <p className="mt-1.5 typo-body text-foreground">{t.agents.connectors.auto_none_selected}</p>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {designResult.setup_steps && designResult.setup_steps.length > 0 && (
            <div>
              <label className="typo-body font-medium text-foreground uppercase tracking-wider">{t.agents.connectors.auto_what_will_happen}</label>
              <div className="mt-1.5 space-y-1.5">
                {designResult.setup_steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-modal bg-secondary/20 border border-border/40">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center typo-heading font-bold text-primary mt-0.5">{i + 1}</span>
                    <p className="typo-body text-foreground leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {designResult.handles_connectors && designResult.handles_connectors.length > 0 && (
            <div>
              <label className="typo-body font-medium text-foreground uppercase tracking-wider">{t.agents.connectors.auto_replaces}</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {designResult.handles_connectors.map((c) => (
                  <span key={c} className="px-2 py-0.5 typo-body rounded-card bg-secondary/40 border border-border/40 text-foreground">{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <button onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 typo-body font-medium text-foreground hover:text-foreground transition-colors">
        <Pencil className="w-3.5 h-3.5" />
        {showAdvanced ? t.agents.connectors.auto_hide_advanced : t.agents.connectors.auto_show_advanced}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
      </button>

      {showAdvanced && (
          <div className="animate-fade-slide-in overflow-hidden space-y-4">
            <div>
              <label className="typo-body font-medium text-foreground uppercase tracking-wider">Input Schema</label>
              <textarea placeholder='{ "file_url": "string" }' value={inputSchema} onChange={(e) => setInputSchema(e.target.value)} rows={3}
                className="w-full mt-1.5 px-3 py-2 typo-code rounded-modal border border-border bg-secondary/20 text-foreground placeholder:text-foreground font-mono focus-ring resize-none" />
            </div>
            <div>
              <label className="typo-body font-medium text-foreground uppercase tracking-wider">On failure</label>
              <div className="mt-1.5 space-y-1.5">
                {FALLBACK_OPTIONS.map((opt) => (
                  <label key={opt.value} className={`flex items-start gap-2.5 p-2.5 rounded-card border cursor-pointer transition-colors ${fallbackMode === opt.value ? 'border-primary/30 bg-primary/5' : 'border-border/60 hover:border-border'}`}>
                    <input type="radio" name="fallbackMode" checked={fallbackMode === opt.value} onChange={() => setFallbackMode(opt.value)} className="mt-0.5 accent-primary" />
                    <div>
                      <p className="typo-body text-foreground">{opt.label}</p>
                      <p className="typo-body text-foreground">{opt.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="typo-body font-medium text-foreground uppercase tracking-wider">Timeout</label>
              <div className="flex items-center gap-2 mt-1.5">
                <input type="number" min={1} max={300} value={timeoutSecs} onChange={(e) => setTimeoutSecs(Number(e.target.value) || 30)}
                  className="w-20 px-3 py-2 typo-body rounded-modal border border-border bg-secondary/20 text-foreground focus-ring" />
                <span className="typo-body text-foreground">seconds</span>
              </div>
            </div>
          </div>
        )}

      {deployError && (
        <div className="flex items-start gap-2.5 p-3 rounded-modal bg-brand-rose/5 border border-brand-rose/15">
          <AlertCircle className="w-4 h-4 text-brand-rose/70 flex-shrink-0 mt-0.5" />
          <div>
            <p className="typo-body font-medium text-brand-rose/80">Deployment failed</p>
            <p className="typo-body text-brand-rose/50 mt-0.5">{deployError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
