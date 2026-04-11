import { CheckCircle2, AlertCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { AutomationPlatform } from '@/lib/bindings/PersonaAutomation';
import type { DeployAutomationResult } from '@/api/agents/automations';
import { PLATFORM_CONFIG } from '../../libs/automationTypes';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { useTranslation } from '@/i18n/useTranslation';

interface AutomationReviewStepProps {
  platform: AutomationPlatform;
  deployResult: DeployAutomationResult | null;
  designError: string | null;
  onComplete: () => void;
  onClose: () => void;
  onReset: () => void;
  phase: 'deploying' | 'success' | 'error';
}

export function AutomationReviewStep({
  platform, deployResult, designError,
  onComplete, onClose, onReset, phase,
}: AutomationReviewStepProps) {
  const { t } = useTranslation();
  if (phase === 'deploying') {
    return (
      <div key="deploying" className="animate-fade-slide-in flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
          <LoadingSpinner size="lg" className="text-accent" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground/90">
            {t.agents.connectors.auto_deploying_to.replace('{platform}', PLATFORM_CONFIG[platform]?.label ?? platform)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {platform === 'n8n' && t.agents.connectors.auto_deploy_n8n}
            {platform === 'github_actions' && t.agents.connectors.auto_deploy_github}
            {platform === 'zapier' && t.agents.connectors.auto_deploy_zapier}
            {platform === 'custom' && t.agents.connectors.auto_deploy_custom}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'success' && deployResult) {
    const hasWarning = !!deployResult.activationWarning;
    return (
      <div key="success" className="animate-fade-slide-in flex flex-col items-center justify-center py-12 space-y-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${hasWarning ? 'bg-brand-amber/10 border border-brand-amber/20' : 'bg-brand-emerald/10 border border-brand-emerald/20'}`}>
          {hasWarning
            ? <AlertTriangle className="w-5 h-5 text-brand-amber" />
            : <CheckCircle2 className="w-5 h-5 text-brand-emerald" />}
        </div>
        <div className="text-center max-w-md">
          <p className="text-sm font-medium text-foreground/90">
            {hasWarning ? t.agents.connectors.auto_deployed_warning : t.agents.connectors.auto_deployed_ok}
          </p>
          <p className="text-sm text-muted-foreground mt-1">{deployResult.deploymentMessage}</p>
        </div>
        {hasWarning && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-brand-amber/5 border border-brand-amber/15 max-w-md">
            <AlertTriangle className="w-4 h-4 text-brand-amber/70 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-brand-amber/80">{deployResult.activationWarning}</p>
          </div>
        )}
        {sanitizeExternalUrl(deployResult.platformUrl) && (
          <a
            href={sanitizeExternalUrl(deployResult.platformUrl)!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-accent/15 border border-accent/25 text-foreground/80 hover:bg-accent/25 transition-colors"
          >
            {t.agents.connectors.auto_view_on.replace('{platform}', PLATFORM_CONFIG[platform]?.label ?? platform)}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <button
          onClick={() => { onComplete(); onClose(); }}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors"
        >
          {t.agents.connectors.auto_done}
        </button>
      </div>
    );
  }

  // Error phase
  return (
    <div key="error" className="animate-fade-slide-in space-y-4">
      <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-brand-rose/5 border border-brand-rose/15">
        <AlertCircle className="w-4 h-4 text-brand-rose/70 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-brand-rose/80">{t.agents.connectors.auto_design_failed}</p>
          <p className="text-sm text-brand-rose/50 mt-0.5">{designError || t.agents.connectors.auto_unknown_error}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-border text-muted-foreground hover:bg-secondary/50 transition-colors">
          {t.common.close}
        </button>
        <button onClick={onReset} className="px-4 py-2 text-sm font-medium rounded-xl bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors">
          {t.agents.connectors.auto_try_again}
        </button>
      </div>
    </div>
  );
}
