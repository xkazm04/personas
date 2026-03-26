import { useCallback } from 'react';
import { Globe, Shield, ArrowRight, ExternalLink, MessageSquare, LogIn } from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('auto-cred-consent');
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { AutoCredMode } from '../helpers/types';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { buildConnectorContext } from '../helpers/types';
import { openExternalUrl } from '@/api/system/system';

interface AutoCredConsentProps {
  designResult: CredentialDesignResult;
  onConsent: () => void;
  onCancel: () => void;
  mode?: AutoCredMode;
}

export function AutoCredConsent({ designResult, onConsent, onCancel, mode = 'playwright' }: AutoCredConsentProps) {
  const ctx = buildConnectorContext(designResult);
  const fieldCount = ctx.fields.length;
  const isGuided = mode === 'guided';

  const handleDocsClick = useCallback(() => {
    if (ctx.docsUrl) {
      openExternalUrl(ctx.docsUrl).catch((err) => { logger.error('Failed to open docs URL', { error: String(err) }); });
    }
  }, [ctx.docsUrl]);

  return (
    <div
      className="animate-fade-slide-in space-y-4"
    >
      {/* Header */}
      <div className={`flex items-start gap-4 p-4 rounded-xl border ${
        isGuided ? 'border-violet-500/20 bg-violet-500/5' : 'border-cyan-500/20 bg-cyan-500/5'
      }`}>
        <div
          className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${designResult.connector.color}15`, borderColor: `${designResult.connector.color}30` }}
        >
          <Globe className="w-6 h-6" style={{ color: designResult.connector.color }} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {isGuided ? 'Guided Setup' : 'Auto-Setup'}: {designResult.connector.label}
          </h3>
          <p className="text-sm text-muted-foreground/80 mt-1">
            {isGuided
              ? 'Claude will guide you step-by-step through creating credentials. URLs will open in your browser automatically.'
              : 'Claude designed the credential schema. Now Playwright will open a browser to create the actual credential on your behalf.'
            }
          </p>
        </div>
      </div>

      {/* What will happen */}
      <div className="space-y-2.5">
        <p className="text-sm font-medium text-foreground/90">What will happen:</p>
        <div className="space-y-2">
          {isGuided ? (
            <>
              <Step number={1} text={`Open ${designResult.connector.label} dashboard in your browser`} guided />
              <Step number={2} text="Claude provides step-by-step instructions" guided />
              <Step number={3} text={`You create the credential following the guide (${fieldCount} field${fieldCount !== 1 ? 's' : ''})`} guided />
              <Step number={4} text="Claude extracts the values from its instructions" guided />
              <Step number={5} text="Review and save the credential" guided />
            </>
          ) : (
            <>
              <Step number={1} text={`Open ${ctx.docsUrl ? 'credential page' : designResult.connector.label + ' dashboard'} in browser`} />
              <Step number={2} text="Navigate to token/key creation form" />
              <Step number={3} text={`Fill required fields (${fieldCount} field${fieldCount !== 1 ? 's' : ''})`} />
              <Step number={4} text="Extract generated credential values" />
              <Step number={5} text="Return here for your review before saving" />
            </>
          )}
        </div>
      </div>

      {/* Setup instructions summary */}
      {designResult.setup_instructions && (
        <div className="p-3 rounded-lg border border-primary/10 bg-secondary/20">
          <p className="text-sm font-medium text-muted-foreground/60 mb-1.5">Setup context from design analysis:</p>
          <MarkdownRenderer
            content={designResult.setup_instructions}
            className="[&_p]:text-sm [&_p]:text-muted-foreground/80 [&_p]:mb-1.5 [&_ul]:text-sm [&_ol]:text-sm [&_li]:text-muted-foreground/80 [&_code]:text-sm"
          />
        </div>
      )}

      {/* Pre-login tip */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
        <LogIn className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground/80">
          <span className="font-medium text-blue-400/90">Log in first.</span>{' '}
          Make sure you are already registered and logged in to {designResult.connector.label} in your browser before starting.
          This allows the automation to access your account settings directly.
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <Shield className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground/80">
          <span className="font-medium text-amber-400/90">Your consent is required.</span>{' '}
          {isGuided
            ? 'Nothing is saved without your explicit approval. You will create the credential yourself following guided instructions.'
            : 'Nothing is saved without your explicit approval. If a login page or CAPTCHA appears, the browser will pause for you to handle manually.'
          }
        </div>
      </div>

      {/* Docs link -- uses Tauri open_external_url instead of <a href> */}
      {ctx.docsUrl && (
        <button
          onClick={handleDocsClick}
          className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View credential docs
        </button>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-xl hover:bg-secondary/40 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConsent}
          className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium transition-all shadow-lg ${
            isGuided
              ? 'bg-violet-600 hover:bg-violet-500 shadow-violet-600/20'
              : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-600/20'
          }`}
        >
          {isGuided ? (
            <MessageSquare className="w-4 h-4" />
          ) : (
            <Globe className="w-4 h-4" />
          )}
          {isGuided ? 'Start Guided Setup' : 'Start Browser Session'}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function Step({ number, text, guided = false }: { number: number; text: string; guided?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-5 h-5 rounded-full text-sm font-medium flex items-center justify-center shrink-0 ${
        guided ? 'bg-violet-500/15 text-violet-400' : 'bg-cyan-500/15 text-cyan-400'
      }`}>
        {number}
      </span>
      <span className="text-sm text-foreground/80">{text}</span>
    </div>
  );
}
