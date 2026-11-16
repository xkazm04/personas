import { useCallback } from 'react';
import { Globe, Shield, ArrowRight, ExternalLink, MessageSquare, LogIn } from 'lucide-react';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { AutoCredMode } from '../helpers/types';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { buildConnectorContext } from '../helpers/types';
import { openExternalUrl } from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

interface AutoCredConsentProps {
  designResult: CredentialDesignResult;
  onConsent: () => void;
  onCancel: () => void;
  mode?: AutoCredMode;
}

export function AutoCredConsent({ designResult, onConsent, onCancel, mode = 'playwright' }: AutoCredConsentProps) {
  const { t, tx } = useTranslation();
  const ac = t.vault.auto_cred;
  const ace = t.vault.auto_cred_extra;
  const ctx = buildConnectorContext(designResult);
  const fieldCount = ctx.fields.length;
  const isGuided = mode === 'guided';

  const handleDocsClick = useCallback(() => {
    if (ctx.docsUrl) {
      openExternalUrl(ctx.docsUrl).catch(silentCatch('AutoCredConsent:openDocsUrl'));
    }
  }, [ctx.docsUrl]);

  return (
    <div
      data-testid="vault-autocred-consent"
      className="animate-fade-slide-in space-y-4"
    >
      {/* Header */}
      <div className={`flex items-start gap-4 p-4 rounded-modal border ${
        isGuided ? 'border-role-agent/20 bg-role-agent/5' : 'border-role-highlight/20 bg-role-highlight/5'
      }`}>
        <div
          className="w-12 h-12 rounded-modal border flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${designResult.connector.color}15`, borderColor: `${designResult.connector.color}30` }}
        >
          <Globe className="w-6 h-6" style={{ color: designResult.connector.color }} />
        </div>
        <div>
          <h3 className="typo-body-lg text-foreground">
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
        <p className="typo-body text-ink-1">{ac.what_will_happen}</p>
        <div className="space-y-2">
          {isGuided ? (
            <>
              <Step number={1} text={tx(ace.step_guided_open, { label: designResult.connector.label })} guided />
              <Step number={2} text={ace.step_guided_instructions} guided />
              <Step number={3} text={tx(fieldCount === 1 ? ace.step_guided_fill_one : ace.step_guided_fill_other, { count: fieldCount })} guided />
              <Step number={4} text={ace.step_guided_extract} guided />
              <Step number={5} text={ace.step_guided_review} guided />
            </>
          ) : (
            <>
              <Step
                number={1}
                text={
                  ctx.docsUrl
                    ? ace.step_browser_open_with_docs
                    : tx(ace.step_browser_open_without_docs, { label: designResult.connector.label })
                }
              />
              <Step number={2} text={ace.step_browser_navigate} />
              <Step number={3} text={tx(fieldCount === 1 ? ace.step_browser_fill_one : ace.step_browser_fill_other, { count: fieldCount })} />
              <Step number={4} text={ace.step_browser_extract} />
              <Step number={5} text={ace.step_browser_review} />
            </>
          )}
        </div>
      </div>

      {/* Setup instructions summary */}
      {designResult.setup_instructions && (
        <div className="p-3 rounded-card border border-hair bg-surface-1">
          <p className="typo-body text-foreground mb-1.5">{t.vault.auto_cred_extra.setup_context}</p>
          <MarkdownRenderer
            content={designResult.setup_instructions}
            className="[&_p]:text-foreground [&_p]:mb-1.5 [&_li]:text-foreground"
          />
        </div>
      )}

      {/* Pre-login tip */}
      <div className="flex items-start gap-2.5 p-3 rounded-card border border-hair bg-surface-1">
        <LogIn className="w-4 h-4 text-status-info mt-0.5 shrink-0" />
        <div className="typo-body text-foreground">
          <span className="font-medium text-status-info/90">{ac.log_in_first}</span>{' '}
          {tx(ac.log_in_hint, { label: designResult.connector.label })}
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-card border border-status-warning/20 bg-status-warning/5">
        <Shield className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
        <div className="typo-body text-foreground">
          <span className="font-medium text-status-warning/90">{ac.your_consent}</span>{' '}
          {isGuided
            ? ac.guided_consent_hint
            : ac.auto_consent_hint
          }
        </div>
      </div>

      {/* Docs link -- uses Tauri open_external_url instead of <a href> */}
      {ctx.docsUrl && (
        <Button
          type="button"
          onClick={handleDocsClick}
          variant="ghost"
          size="sm"
          icon={<ExternalLink className="w-3.5 h-3.5" />}
        >
          {ac.view_docs}
        </Button>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <Button
          type="button"
          onClick={onCancel}
          variant="ghost"
          size="md"
        >
          {t.common.cancel}
        </Button>
        <Button
          type="button"
          onClick={onConsent}
          data-testid="vault-autocred-start"
          variant={isGuided ? 'accent' : 'accent'}
          tone={isGuided ? 'agent' : 'highlight'}
          size="md"
          iconRight={<ArrowRight className="w-3.5 h-3.5" />}
          icon={isGuided ? (
            <MessageSquare className="w-4 h-4" />
          ) : (
            <Globe className="w-4 h-4" />
          )}
        >
          {isGuided ? ac.start_guided : ac.start_browser}
        </Button>
      </div>
    </div>
  );
}

function Step({ number, text, guided = false }: { number: number; text: string; guided?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-5 h-5 rounded-full typo-body flex items-center justify-center shrink-0 ${
        guided ? 'bg-role-agent/15 text-role-agent' : 'bg-role-highlight/15 text-role-highlight'
      }`}>
        {number}
      </span>
      <span className="typo-body text-foreground">{text}</span>
    </div>
  );
}
