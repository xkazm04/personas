import { CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { AutomationPlatform } from '@/lib/bindings/PersonaAutomation';
import type { DeployAutomationResult } from '@/api/agents/automations';
import { PLATFORM_CONFIG } from '../../libs/automationTypes';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';

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
  if (phase === 'deploying') {
    return (
      <div key="deploying" className="animate-fade-slide-in flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
          <LoadingSpinner size="lg" className="text-accent" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground/90">
            Deploying to {PLATFORM_CONFIG[platform]?.label}...
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {platform === 'n8n' && 'Creating workflow and activating on your n8n instance'}
            {platform === 'github_actions' && 'Setting up repository dispatch integration'}
            {platform === 'zapier' && 'Validating and connecting catch hook'}
            {platform === 'custom' && 'Saving automation configuration'}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'success' && deployResult) {
    return (
      <div key="success" className="animate-fade-slide-in flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-12 h-12 rounded-full bg-brand-emerald/10 border border-brand-emerald/20 flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5 text-brand-emerald" />
        </div>
        <div className="text-center max-w-md">
          <p className="text-sm font-medium text-foreground/90">Automation deployed successfully</p>
          <p className="text-sm text-muted-foreground mt-1">{deployResult.deploymentMessage}</p>
        </div>
        {sanitizeExternalUrl(deployResult.platformUrl) && (
          <a
            href={sanitizeExternalUrl(deployResult.platformUrl)!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-accent/15 border border-accent/25 text-foreground/80 hover:bg-accent/25 transition-colors"
          >
            View on {PLATFORM_CONFIG[platform]?.label}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <button
          onClick={() => { onComplete(); onClose(); }}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors"
        >
          Done
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
          <p className="text-sm font-medium text-brand-rose/80">Design failed</p>
          <p className="text-sm text-brand-rose/50 mt-0.5">{designError || 'Unknown error'}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-border text-muted-foreground hover:bg-secondary/50 transition-colors">
          Close
        </button>
        <button onClick={onReset} className="px-4 py-2 text-sm font-medium rounded-xl bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors">
          Try Again
        </button>
      </div>
    </div>
  );
}
