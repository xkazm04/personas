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
      <div className="flex items-start gap-4 p-4 rounded-modal border border-violet-500/20 bg-violet-500/5">
        <div className="w-12 h-12 rounded-modal border border-violet-500/30 bg-violet-500/10 flex items-center justify-center shrink-0">
          <Radar className="w-6 h-6 text-violet-400" />
        </div>
        <div>
          <h3 className="typo-body-lg font-semibold text-foreground">{fg.consent_heading}</h3>
          <p className="typo-body text-foreground mt-1">{fg.consent_body}</p>
        </div>
      </div>

      {/* What gets scanned */}
      <div className="space-y-2.5">
        <p className="typo-body font-medium text-foreground/90">{fg.consent_what_scanned}</p>
        <div className="space-y-1.5">
          {SOURCE_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2.5">
              <Check className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="typo-body text-foreground">{fg[key]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Read-only notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-card border border-blue-500/20 bg-blue-500/5">
        <Shield className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <span className="typo-body text-foreground">{fg.consent_readonly}</span>
      </div>

      {/* Privacy notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-card border border-amber-500/20 bg-amber-500/5">
        <Lock className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="typo-body text-foreground">
          <span className="font-medium text-amber-400/90">{fg.consent_privacy_title}</span>{' '}
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
          accentColor="violet"
          data-testid="vault-foraging-scan"
          className="bg-violet-500/15 text-violet-400 border-violet-500/25 hover:bg-violet-500/25"
        >
          {fg.start_scan}
        </Button>
      </div>
    </div>
  );
}
