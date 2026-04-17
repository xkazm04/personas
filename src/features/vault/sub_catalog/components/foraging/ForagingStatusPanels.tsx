import {
  Radar,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ForagingResultCard } from './ForagingResultCard';
import { Button } from '@/features/shared/components/buttons';
import type { useCredentialForaging } from '@/hooks/design/credential/useCredentialForaging';
import { useTranslation } from '@/i18n/useTranslation';

type Forage = ReturnType<typeof useCredentialForaging>;

interface ForagingIdleProps {
  onScan: () => void;
}

export function ForagingIdle({ onScan }: ForagingIdleProps) {
  const { t } = useTranslation();
  const forg = t.vault.foraging;
  return (
    <div
      key="idle"
      className="animate-fade-slide-in rounded-modal border border-primary/15 bg-secondary/25 p-6 text-center space-y-4"
    >
      <EmptyIllustration
        icon={Radar}
        heading="Credential Foraging"
        description={forg.scan_description}
      />
      <Button
        variant="accent"
        size="sm"
        icon={<Sparkles className="w-3.5 h-3.5" />}
        onClick={onScan}
        accentColor="violet"
        data-testid="vault-foraging-scan"
        className="bg-violet-500/15 text-violet-400 border-violet-500/25 hover:bg-violet-500/25"
      >
        {forg.start_scan}
      </Button>
      <div className="typo-body text-foreground space-y-0.5">
        <p>{forg.scan_locations}</p>
        <p>{forg.scan_privacy}</p>
      </div>
    </div>
  );
}

export function ForagingScanning() {
  const { t } = useTranslation();
  return (
    <div
      key="scanning"
      className="animate-fade-slide-in rounded-modal border border-violet-500/20 bg-violet-500/5 p-8 text-center space-y-3"
    >
      <LoadingSpinner size="2xl" className="text-violet-400 mx-auto" />
      <p className="typo-body text-foreground">{t.vault.foraging.scanning}</p>
      <p className="typo-body text-foreground">
        {t.vault.foraging.checking_env}
      </p>
    </div>
  );
}

interface ForagingImportingProps {
  forage: Forage;
}

export function ForagingImporting({ forage }: ForagingImportingProps) {
  const { t } = useTranslation();
  const forg = t.vault.foraging;
  return (
    <div
      key="importing"
      className="animate-fade-slide-in space-y-3"
    >
      <div className="rounded-modal border border-violet-500/20 bg-violet-500/5 p-4 text-center space-y-2">
        <LoadingSpinner size="xl" className="text-violet-400 mx-auto" />
        <p className="typo-body text-foreground">
          {forg.importing}
        </p>
        <p className="typo-body text-foreground">
          {forage.imported.size} of {forage.selected.size} complete
        </p>
      </div>
      {forage.scanResult && (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
          {forage.scanResult.credentials
            .filter((c) => forage.selected.has(c.id))
            .map((cred) => (
              <ForagingResultCard
                key={cred.id}
                credential={cred}
                isSelected={true}
                isImporting={forage.importingIds.has(cred.id)}
                isImported={forage.imported.has(cred.id)}
                onToggle={() => {}}
              />
            ))}
        </div>
      )}
    </div>
  );
}

interface ForagingDoneProps {
  forage: Forage;
  onBack: () => void;
}

export function ForagingDone({ forage, onBack }: ForagingDoneProps) {
  const { t, tx } = useTranslation();
  const forg = t.vault.foraging;
  const count = forage.imported.size;
  return (
    <div
      key="done"
      className="animate-fade-slide-in rounded-modal border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-3"
    >
      <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
      <div>
        <p className="typo-body font-medium text-foreground/90">
          {tx(count === 1 ? forg.env_var_one : forg.env_var_other, { count })} {forg.imported} {forg.to_vault}
        </p>
        {forage.error && (
          <p className="typo-body text-amber-400/80 mt-1">{forage.error}</p>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="link"
          size="sm"
          onClick={forage.scan}
          className="text-foreground hover:text-foreground/80"
        >
          {forg.scan_again}
        </Button>
        <span className="text-foreground">|</span>
        <Button
          variant="link"
          size="sm"
          onClick={onBack}
          className="text-violet-400/80 hover:text-violet-400"
        >
          {forg.back_to_vault}
        </Button>
      </div>
    </div>
  );
}

interface ForagingErrorProps {
  forage: Forage;
  onBack: () => void;
}

export function ForagingError({ forage, onBack }: ForagingErrorProps) {
  const { t } = useTranslation();
  return (
    <div
      key="error"
      className="animate-fade-slide-in rounded-modal border border-red-500/20 bg-red-500/5 p-6 text-center space-y-3"
    >
      <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
      <div>
        <p className="typo-body font-medium text-foreground/90">{t.vault.foraging.scan_failed}</p>
        <p className="typo-body text-red-400/70 mt-1">{forage.error}</p>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="link"
          size="sm"
          onClick={forage.scan}
          className="text-violet-400/80 hover:text-violet-400"
        >
          {t.vault.negotiator.try_again}
        </Button>
        <span className="text-foreground">|</span>
        <Button
          variant="link"
          size="sm"
          onClick={onBack}
          className="text-foreground hover:text-foreground/80"
        >
          {t.common.back}
        </Button>
      </div>
    </div>
  );
}
