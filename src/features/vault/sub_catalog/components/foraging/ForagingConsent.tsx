import { Radar, Shield, Lock, Sparkles, Check } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';

type ForagingLabelKey = keyof Translations['vault']['foraging'];

/**
 * Pre-scan informed-consent step for credential foraging. Mirrors
 * AutoCredConsent's structure: it names every source class the scan reads
 * BEFORE any secret is touched, so reading real credentials from disk is never
 * a surprise. Only after the user clicks "Start scan" does `onScan` run.
 */
interface ForagingConsentProps {
  onScan: () => void;
}

// The eight source classes the backend scanner reads, in scan order.
const SOURCE_KEYS: ForagingLabelKey[] = [
  'consent_src_env',
  'consent_src_aws',
  'consent_src_kube',
  'consent_src_dotenv',
  'consent_src_npmrc',
  'consent_src_docker',
  'consent_src_github',
  'consent_src_ssh',
];

export function ForagingConsent({ onScan }: ForagingConsentProps) {
  const { t } = useTranslation();
  const fg = t.vault.foraging;

  return (
    <div data-testid="vault-foraging-consent" className="animate-fade-slide-in space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4 p-4 rounded-modal border border-hair bg-surface-1">
        <div className="w-12 h-12 rounded-modal border border-role-agent/30 bg-role-agent/10 flex items-center justify-center shrink-0">
          <Radar className="w-6 h-6 text-role-agent" />
        </div>
        <div>
          <h3 className="typo-body-lg text-foreground">{fg.consent_heading}</h3>
          <p className="typo-body text-foreground mt-1">{fg.consent_body}</p>
        </div>
      </div>

      {/* What gets scanned */}
      <div className="space-y-2.5">
        <p className="typo-body text-ink-1">{fg.consent_what_scanned}</p>
        <div className="space-y-1.5">
          {SOURCE_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2.5">
              <Check className="w-3.5 h-3.5 text-role-agent shrink-0" />
              <span className="typo-body text-foreground">{fg[key]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Read-only notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-card border border-hair bg-surface-1">
        <Shield className="w-4 h-4 text-status-info mt-0.5 shrink-0" />
        <span className="typo-body text-foreground">{fg.consent_readonly}</span>
      </div>

      {/* Privacy notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-card border border-status-warning/20 bg-status-warning/5">
        <Lock className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
        <div className="typo-body text-foreground">
          <span className="font-medium text-status-warning/90">{fg.consent_privacy_title}</span>{' '}
          {fg.consent_privacy_body}
        </div>
      </div>

      {/* Action */}
      <div className="flex justify-end pt-1">
        <Button
          variant="accent"
          size="md"
          icon={<Sparkles className="w-4 h-4" />}
          onClick={onScan}
          tone="agent"
          data-testid="vault-foraging-scan"
          className="bg-role-agent/15 text-role-agent border-role-agent/25 hover:bg-role-agent/25"
        >
          {fg.start_scan}
        </Button>
      </div>
    </div>
  );
}
