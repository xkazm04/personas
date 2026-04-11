import { Download } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { Radar } from 'lucide-react';
import { ForagingResultCard } from './ForagingResultCard';
import { Button } from '@/features/shared/components/buttons';
import type { useCredentialForaging } from '@/hooks/design/credential/useCredentialForaging';
import { useTranslation } from '@/i18n/useTranslation';

type Forage = ReturnType<typeof useCredentialForaging>;

interface ForagingResultsProps {
  forage: Forage;
  importableCount: number;
  onImport: () => void;
}

export function ForagingResults({ forage, importableCount, onImport }: ForagingResultsProps) {
  const { t } = useTranslation();
  if (!forage.scanResult) return null;

  return (
    <div
      key="results"
      className="animate-fade-slide-in space-y-3"
    >
      {/* Summary bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground/80">
            {forage.scanResult.credentials.length} credential
            {forage.scanResult.credentials.length !== 1 ? 's' : ''} found
          </span>
          {importableCount > 0 && (
            <span className="text-sm text-muted-foreground/50">
              {forage.selected.size} selected
            </span>
          )}
        </div>
        {importableCount > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="link"
              size="sm"
              onClick={forage.selectAll}
              className="text-violet-400/80 hover:text-violet-400"
            >
              All
            </Button>
            <span className="text-muted-foreground/20">|</span>
            <Button
              variant="link"
              size="sm"
              onClick={forage.selectNone}
              className="text-muted-foreground/50 hover:text-foreground/70"
            >
              None
            </Button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {forage.scanResult.credentials.length === 0 && (
        <div className="rounded-xl border border-primary/15 bg-secondary/25 p-6">
          <EmptyIllustration
            icon={Radar}
            heading={t.vault.foraging.no_credentials_found}
            description={t.vault.foraging.no_credentials_hint}
          />
        </div>
      )}

      {/* Credential cards */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {forage.scanResult.credentials.map((cred) => (
          <ForagingResultCard
            key={cred.id}
            credential={cred}
            isSelected={forage.selected.has(cred.id)}
            isImporting={forage.importingIds.has(cred.id)}
            isImported={forage.imported.has(cred.id)}
            onToggle={() => forage.toggleSelect(cred.id)}
          />
        ))}
      </div>

      {/* Import button */}
      {forage.selected.size > 0 && (
        <Button
          variant="accent"
          size="md"
          icon={<Download className="w-4 h-4" />}
          block
          onClick={onImport}
          accentColor="violet"
          className="bg-violet-500/15 text-violet-400 border-violet-500/25 hover:bg-violet-500/25"
        >
          Import {forage.selected.size} credential{forage.selected.size !== 1 ? 's' : ''} to vault
        </Button>
      )}
    </div>
  );
}
