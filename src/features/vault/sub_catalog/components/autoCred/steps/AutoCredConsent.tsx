import { useCallback } from 'react';
import { Globe, Shield, ArrowRight, ExternalLink, MessageSquare, LogIn } from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('auto-cred-consent');
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { AutoCredMode } from '../helpers/types';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { buildConnectorContext } from '../helpers/types';
import { openExternalUrl } from '@/api/system/system';
import { useTranslation } from '@/i18n/useTranslation';

interface AutoCredConsentProps {
  designResult: CredentialDesignResult;
  onConsent: () => void;
  onCancel: () => void;
  mode?: AutoCredMode;
}

export function AutoCredConsent({ designResult, onConsent, onCancel, mode = 'playwright' }: AutoCredConsentProps) {
  const { t } = useTranslation();
  const ac = t.vault.auto_cred;
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
      <div className={`flex items-start gap-4 p-4 rounded-modal border ${
        isGuided ? 'border-violet-500/20 bg-violet-500/5' : 'border-cyan-500/20 bg-cyan-500/5'
      }`}>
        <div
          className="w-12 h-12 rounded-modal border flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${designResult.connector.color}15`, borderColor: `${designResult.connector.color}30` }}
        >
          <Globe className="w-6 h-6" style={{ color: designResult.connector.color }} />
        </div>
        <div>
          <h3 className="typo-body-lg font-semibold text-foreground">
            {isGuided ? ac.guided_setup : ac.auto_setup}: {designResult.connector.label}
          </h3>
          <p className="typo-body text-foreground mt-1">
            {isGuided
              ? ac.guided_consent_body
              : ac.auto_consent_body
            }
          </p>
        </div>
      </div>

      {/* What will happen */}
      <div className="space-y-2.5">
        <p className="typo-body font-medium text-foreground/90">{ac.what_will_happen}</p>
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
        <div className="p-3 rounded-card border border-primary/10 bg-secondary/20">
          <p className="typo-body font-medium text-foreground mb-1.5">{t.vault.auto_cred_extra.setup_context}</p>
          <MarkdownRenderer
            content={designResult.setup_instructions}
            className="[&_p]:typo-body [&_p]:text-foreground [&_p]:mb-1.5 [&_ul]:typo-body [&_ol]:typo-body [&_li]:text-foreground [&_code]:typo-body"
          />
        </div>
      )}

      {/* Pre-login tip */}
      <div className="flex items-start gap-2.5 p-3 rounded-card border border-blue-500/20 bg-blue-500/5">
        <LogIn className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="typo-body text-foreground">
          <span className="font-medium text-blue-400/90">{ac.log_in_first}</span>{' '}
          {t.vault.auto_cred.log_in_hint.replace('{label}', designResult.connector.label)}
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-card border border-amber-500/20 bg-amber-500/5">
        <Shield className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="typo-body text-foreground">
          <span className="font-medium text-amber-400/90">{ac.your_consent}</span>{' '}
          {isGuided
            ? ac.guided_consent_hint
            : ac.auto_consent_hint
          }
        </div>
      </div>

      {/* Docs link -- uses Tauri open_external_url instead of <a href> */}
      {ctx.docsUrl && (
        <button
          onClick={handleDocsClick}
          className="inline-flex items-center gap-1.5 typo-body text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {ac.view_docs}
        </button>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 typo-body text-foreground hover:text-foreground rounded-modal hover:bg-secondary/40 transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          onClick={onConsent}
          className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-modal typo-body font-medium transition-all shadow-elevation-3 ${
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
          {isGuided ? ac.start_guided : ac.start_browser}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function Step({ number, text, guided = false }: { number: number; text: string; guided?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-5 h-5 rounded-full typo-body font-medium flex items-center justify-center shrink-0 ${
        guided ? 'bg-violet-500/15 text-violet-400' : 'bg-cyan-500/15 text-cyan-400'
      }`}>
        {number}
      </span>
      <span className="typo-body text-foreground">{text}</span>
    </div>
  );
}
