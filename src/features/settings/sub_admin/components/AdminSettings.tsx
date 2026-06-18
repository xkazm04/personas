import { useEffect, useRef, useState } from 'react';
import { Shield, RotateCcw, Play, AlertTriangle, ScrollText } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { CONSENT_KEY, hasUserConsented, resetUserConsent } from '@/features/shared/components/overlays/FirstUseConsentModal';
import { useTranslation } from '@/i18n/useTranslation';

export default function AdminSettings() {
  const [consentStatus, setConsentStatus] = useState(hasUserConsented);
  const [confirmConsentReset, setConfirmConsentReset] = useState(false);
  const { t } = useTranslation();
  const s = t.settings.admin;

  // Clear the pending confirm-flag auto-revert timer on unmount so it doesn't
  // setState after unmount (and doesn't fire after a re-click that would have
  // reset the flag on its own).
  const consentResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (consentResetTimerRef.current) clearTimeout(consentResetTimerRef.current);
  }, []);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Shield className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={s.title}
        subtitle={s.subtitle}
      />
      <ContentBody>
        <div className="max-w-3xl mx-auto">
          <SectionCard
            title={s.user_consent}
            subtitle={s.consent_hint}
            icon={<ScrollText className="w-4 h-4 text-cyan-400" />}
            titleClassName="text-primary"
            action={
              <span className={`inline-flex items-center px-2.5 py-1 rounded-card text-[11px] font-semibold border ${
                consentStatus
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                  : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              }`}>
                {consentStatus ? s.consent_accepted : s.consent_not_accepted}
              </span>
            }
          >
            <div className="space-y-4">
              <div className="rounded-card bg-secondary/20 border border-primary/8 p-3">
                <p className="text-[11px] uppercase tracking-wider text-foreground mb-1">{s.storage_key}</p>
                <p className="typo-code font-mono text-foreground">{CONSENT_KEY}</p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => {
                    if (!confirmConsentReset) {
                      setConfirmConsentReset(true);
                      if (consentResetTimerRef.current) clearTimeout(consentResetTimerRef.current);
                      consentResetTimerRef.current = setTimeout(() => {
                        consentResetTimerRef.current = null;
                        setConfirmConsentReset(false);
                      }, 3000);
                      return;
                    }
                    if (consentResetTimerRef.current) {
                      clearTimeout(consentResetTimerRef.current);
                      consentResetTimerRef.current = null;
                    }
                    resetUserConsent();
                    setConsentStatus(false);
                    setConfirmConsentReset(false);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-modal border transition-colors ${
                    confirmConsentReset
                      ? 'bg-red-500/15 text-red-300 border-red-500/25 hover:bg-red-500/25'
                      : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20'
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
                    onClick={() => window.location.reload()}
                    className="flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-modal
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
