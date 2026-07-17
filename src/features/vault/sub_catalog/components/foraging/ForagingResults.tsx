import { Download, AlertTriangle } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { Radar } from 'lucide-react';
import { ForagingResultCard } from './ForagingResultCard';
import { Button } from '@/features/shared/components/buttons';
import type { useCredentialForaging } from '@/hooks/design/credential/useCredentialForaging';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';

type Forage = ReturnType<typeof useCredentialForaging>;

type ForagingLabelKey = keyof Translations['vault']['foraging'];

// Backend read-error tokens (ForageSource serde names) → translated source label.
const READ_ERROR_LABEL: Record<string, ForagingLabelKey> = {
  aws_credentials: 'source_aws_credentials',
  aws_config: 'source_aws_config',
  kube_config: 'source_kube_config',
  env_var: 'source_env_var',
  dot_env: 'source_dot_env',
  npmrc: 'source_npmrc',
  docker_config: 'source_docker_config',
  git_hub_cli: 'source_git_hub_cli',
  ssh_key: 'source_ssh_key',
};

interface ForagingResultsProps {
  forage: Forage;
  importableCount: number;
  onImport: () => void;
}

export function ForagingResults({ forage, importableCount, onImport }: ForagingResultsProps) {
  const { t, tx } = useTranslation();
  const fg = t.vault.foraging;
  if (!forage.scanResult) return null;

  const credCount = forage.scanResult.credentials.length;
  const readErrors = forage.scanResult.read_errors ?? [];
  const hasHighConfidence = forage.scanResult.credentials.some(
    (c) => !c.already_imported && c.confidence === 'high',
  );

  return (
    <div
      key="results"
      className="animate-fade-slide-in space-y-3"
    >
      {/* Summary bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <span className="typo-body font-medium text-foreground">
            {tx(credCount !== 1 ? fg.credentials_found_other : fg.credentials_found_one, { count: credCount })}
          </span>
          {importableCount > 0 && (
            <span className="typo-body text-foreground">
              {forage.selected.size} {fg.selected}
            </span>
          )}
        </div>
        {importableCount > 0 && (
          <div className="flex items-center gap-2">
            {hasHighConfidence && (
              <>
                <Button
                  variant="link"
                  size="sm"
                  onClick={forage.selectAllHighConfidence}
                  data-testid="vault-foraging-select-high-confidence"
                  className="text-emerald-400/80 hover:text-emerald-400"
                >
                  {fg.select_high_confidence}
                </Button>
                <span className="text-foreground">|</span>
              </>
            )}
            <Button
              variant="link"
              size="sm"
              onClick={forage.selectAll}
              className="text-violet-400/80 hover:text-violet-400"
            >
              {t.vault.import.select_all}
            </Button>
            <span className="text-foreground">|</span>
            <Button
              variant="link"
              size="sm"
              onClick={forage.selectNone}
              className="text-foreground hover:text-foreground/70"
            >
              {t.vault.import.deselect_all}
            </Button>
          </div>
        )}
      </div>

      {/* Per-source read failures — surfaced, never swallowed */}
      {readErrors.length > 0 && (
        <div
          data-testid="vault-foraging-read-errors"
          className="rounded-modal border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-1"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="typo-body font-medium text-amber-300/80">{fg.read_errors_title}</span>
          </div>
          <ul className="space-y-0.5 pl-5">
            {readErrors.map((token) => {
              const labelKey = READ_ERROR_LABEL[token];
              const source = labelKey ? fg[labelKey] : token;
              return (
                <li key={token} className="typo-body text-amber-200/70">
                  {tx(fg.read_error_item, { source })}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Empty state */}
      {forage.scanResult.credentials.length === 0 && (
        <div className="rounded-modal border border-primary/15 bg-secondary/25 p-6">
          <EmptyIllustration
            icon={Radar}
            heading={fg.no_credentials_found}
            description={fg.no_credentials_hint}
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
          {tx(forage.selected.size !== 1 ? fg.import_to_vault_other : fg.import_to_vault_one, { count: forage.selected.size })}
        </Button>
      )}
    </div>
  );
}
