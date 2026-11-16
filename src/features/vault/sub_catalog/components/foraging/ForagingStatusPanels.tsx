import {
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ForagingResultCard } from './ForagingResultCard';
import { Button } from '@/features/shared/components/buttons';
import type { useCredentialForaging } from '@/hooks/design/credential/useCredentialForaging';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';

type Forage = ReturnType<typeof useCredentialForaging>;

export function ForagingScanning() {
  const { t } = useTranslation();
  return (
    <div
      key="scanning"
      className="animate-fade-slide-in rounded-modal border border-role-agent/20 bg-role-agent/5 p-8 text-center space-y-3"
    >
      <LoadingSpinner size="2xl" className="text-role-agent mx-auto" />
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
  const { t, tx } = useTranslation();
  const forg = t.vault.foraging;
  return (
    <div
      key="importing"
      className="animate-fade-slide-in space-y-3"
    >
      <div className="rounded-modal border border-hair bg-surface-1 p-4 text-center space-y-2">
        <LoadingSpinner size="xl" className="text-role-agent mx-auto" />
        <p className="typo-body text-foreground">
          {forg.importing}
        </p>
        <p className="typo-body text-foreground">
          {tx(forg.import_progress, { done: forage.imported.size, total: forage.selected.size })}
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
      className="animate-fade-slide-in rounded-modal border border-hair bg-surface-1 p-6 text-center space-y-3"
    >
      <CheckCircle2 className="w-8 h-8 text-status-success mx-auto" />
      <div>
        <p className="typo-body text-ink-1">
          {tx(count === 1 ? forg.imported_to_vault_one : forg.imported_to_vault_other, { count })}
        </p>
        {forage.partialImportError && (
          <p className="typo-body text-status-warning/80 mt-1">{forg.partial_import_error}</p>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="link"
          size="sm"
          onClick={forage.scan}
          className="text-foreground hover:text-ink-2"
        >
          {forg.scan_again}
        </Button>
        <span className="text-foreground">|</span>
        <Button
          variant="link"
          size="sm"
          onClick={onBack}
          className="text-role-agent/80 hover:text-role-agent"
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
  const translated = resolveErrorTranslated(t, forage.error);
  return (
    <div
      key="error"
      className="animate-fade-slide-in rounded-modal border border-status-error/20 bg-status-error/5 p-6 text-center space-y-3"
    >
      <AlertTriangle className="w-8 h-8 text-status-error mx-auto" />
      <div>
        <p className="typo-body text-ink-1">{t.vault.foraging.scan_failed}</p>
        <p className="typo-body text-status-error/70 mt-1">{translated.message}</p>
        {translated.suggestion && (
          <p className="typo-body text-foreground mt-1">{translated.suggestion}</p>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="link"
          size="sm"
          onClick={forage.scan}
          className="text-role-agent/80 hover:text-role-agent"
        >
          {t.vault.negotiator.try_again}
        </Button>
        <span className="text-foreground">|</span>
        <Button
          variant="link"
          size="sm"
          onClick={onBack}
          className="text-foreground hover:text-ink-2"
        >
          {t.common.back}
        </Button>
      </div>
    </div>
  );
}
