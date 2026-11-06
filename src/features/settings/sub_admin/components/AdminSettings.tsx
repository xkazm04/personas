import { useState } from 'react';
import { Shield, RotateCcw, Play, AlertTriangle, ScrollText } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { CONSENT_KEY, hasUserConsented, resetUserConsent } from '@/features/shared/components/overlays/FirstUseConsentModal';
import { useTranslation } from '@/i18n/useTranslation';
import { useConfirmClick } from '@/features/settings/shared/useConfirmClick';

export default function AdminSettings() {
  const [consentStatus, setConsentStatus] = useState(hasUserConsented);
  const { t } = useTranslation();
  const s = t.settings.admin;

  // First click arms + auto-reverts after 3s; second click commits the reset.
  // The timer is ref-tracked and cleared on unmount inside the hook.
  const { armed: confirmConsentReset, trigger: triggerConsentReset } = useConfirmClick(
    () => {
      resetUserConsent();
      setConsentStatus(false);
    },
  );

  return (
    <ContentBox>
      <ContentHeader
        icon={<Shield className="w-5 h-5 text-ink-2" />}
        iconColor="violet"
        title={s.title}
        subtitle={s.subtitle}
      />
      <ContentBody>
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          <SectionCard
            title={s.user_consent}
            subtitle={s.consent_hint}
            icon={<ScrollText className="w-4 h-4 text-ink-2" />}
            titleClassName="text-primary"
            action={
              <span className={`inline-flex items-center px-2.5 py-1 rounded-card typo-label border ${
                consentStatus
                  ? 'text-status-success bg-status-success/10 border-status-success/20'
                  : 'text-status-warning bg-status-warning/10 border-status-warning/20'
              }`}>
                {consentStatus ? s.consent_accepted : s.consent_not_accepted}
              </span>
            }
          >
            <div className="space-y-4">
              <div className="rounded-card bg-surface-1 border border-primary/8 p-3">
                <p className="typo-eyebrow text-foreground mb-1">{s.storage_key}</p>
                <p className="typo-code text-foreground">{CONSENT_KEY}</p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={triggerConsentReset}
                  className={`flex items-center gap-2 px-4 py-2 typo-body rounded-modal border transition-colors ${
                    confirmConsentReset
                      ? 'bg-status-error/15 text-status-error border-status-error/25 hover:bg-status-error/25'
                      : 'bg-role-highlight/10 text-role-highlight border border-role-highlight/20 hover:bg-role-highlight/20'
                  }`}
                >
                  {confirmConsentReset ? (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {s.confirm_reset}
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      {s.reset_consent}
                    </>
                  )}
                </button>

                {!consentStatus && (
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="flex items-center gap-2 px-4 py-2 typo-body rounded-modal
                      bg-amber-500/10 text-amber-400 border border-amber-500/20
                      hover:bg-amber-500/20 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {s.reload_modal}
                  </button>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
