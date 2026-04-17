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
  return (
    <div
      key="idle"
      className="animate-fade-slide-in rounded-modal border border-primary/15 bg-secondary/25 p-6 text-center space-y-4"
    >
      <EmptyIllustration
        icon={Radar}
        heading="Credential Foraging"
        description="Scan your filesystem for existing credentials -- AWS profiles, environment variables, .env files, Docker configs, SSH keys, and more. Discovered credentials can be imported into your vault with one click."
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
        Start Scan
      </Button>
      <div className="text-sm text-foreground space-y-0.5">
        <p>Scans: ~/.aws, ~/.kube, env vars, .env, ~/.npmrc, Docker, GitHub CLI, SSH</p>
        <p>No secrets are uploaded -- scanning happens entirely on your machine.</p>
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
      <p className="text-sm text-foreground">{t.vault.foraging.scanning}</p>
      <p className="text-sm text-foreground">
        Checking environment variables, config files, and dev tool credentials
      </p>
    </div>
  );
}

interface ForagingImportingProps {
  forage: Forage;
}

export function ForagingImporting({ forage }: ForagingImportingProps) {
  return (
    <div
      key="importing"
      className="animate-fade-slide-in space-y-3"
    >
      <div className="rounded-modal border border-violet-500/20 bg-violet-500/5 p-4 text-center space-y-2">
        <LoadingSpinner size="xl" className="text-violet-400 mx-auto" />
        <p className="text-sm text-foreground">
          Importing credentials to vault...
        </p>
        <p className="text-sm text-foreground">
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
  return (
    <div
      key="done"
      className="animate-fade-slide-in rounded-modal border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-3"
    >
      <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
      <div>
        <p className="text-sm font-medium text-foreground/90">
          {forage.imported.size} credential{forage.imported.size !== 1 ? 's' : ''} imported
        </p>
        {forage.error && (
          <p className="text-sm text-amber-400/80 mt-1">{forage.error}</p>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="link"
          size="sm"
          onClick={forage.scan}
          className="text-foreground hover:text-foreground/80"
        >
          Scan again
        </Button>
        <span className="text-foreground">|</span>
        <Button
          variant="link"
          size="sm"
          onClick={onBack}
          className="text-violet-400/80 hover:text-violet-400"
        >
          Back to vault
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
        <p className="text-sm font-medium text-foreground/90">{t.vault.foraging.scan_failed}</p>
        <p className="text-sm text-red-400/70 mt-1">{forage.error}</p>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="link"
          size="sm"
          onClick={forage.scan}
          className="text-violet-400/80 hover:text-violet-400"
        >
          Try again
        </Button>
        <span className="text-foreground">|</span>
        <Button
          variant="link"
          size="sm"
          onClick={onBack}
          className="text-foreground hover:text-foreground/80"
        >
          Back
        </Button>
      </div>
    </div>
  );
}
