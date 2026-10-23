import { ArrowLeft, Upload, Terminal } from 'lucide-react';
import { IMPORT_SOURCES, importSourceLabel, type ImportSourceId } from './importHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { VaultErrorBanner } from '@/features/vault/sub_credentials/components/card/banners/VaultErrorBanner';

interface ImportInputPhaseProps {
  sourceId: ImportSourceId;
  rawInput: string;
  onInputChange: (value: string) => void;
  onParse: () => void;
  onBack: () => void;
  /** Why the last Parse found nothing to import. Without it a failed parse
   *  left the user on this phase with no feedback at all. */
  error?: string | null;
}

export function ImportInputPhase({ sourceId, rawInput, onInputChange, onParse, onBack, error }: ImportInputPhaseProps) {
  const { t, tx } = useTranslation();
  const vi = t.vault.import;
  const source = IMPORT_SOURCES.find((s) => s.id === sourceId)!;

  const placeholder = sourceId === 'env_file'
    ? 'OPENAI_API_KEY=sk-...\nGITHUB_TOKEN=ghp_...\nSTRIPE_SECRET_KEY=sk_live_...'
    : sourceId === '1password'
    ? vi.placeholder_1password
    : sourceId === 'aws_secrets'
    ? vi.placeholder_aws_secrets
    : sourceId === 'azure_keyvault'
    ? vi.placeholder_azure_keyvault
    : vi.placeholder_doppler;

  const cliHint = source.cliCommand
    ? tx(vi.cli_hint, { cli: source.cliCommand })
    : vi.env_hint;

  return (
    <div
      className="animate-fade-slide-in space-y-4"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div
          className="w-7 h-7 rounded-card border flex items-center justify-center"
          style={{ backgroundColor: `${source.color}12`, borderColor: `${source.color}30` }}
        >
          <Terminal className="w-3.5 h-3.5" style={{ color: source.color }} />
        </div>
        <div>
          <h3 className="typo-body text-foreground">{tx(t.vault.credential_import.import_from, { source: importSourceLabel(vi, source) })}</h3>
          <p className="typo-body text-foreground">{cliHint}</p>
        </div>
      </div>

      <textarea
        value={rawInput}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={placeholder}
        rows={10}
        autoFocus
        className="w-full px-4 py-3 bg-secondary/40 border border-primary/15 rounded-modal text-foreground typo-code placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all resize-none"
      />

      {error && <VaultErrorBanner message={error} variant="inline" />}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onParse}
          disabled={!rawInput.trim()}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-foreground rounded-modal typo-body transition-all shadow-elevation-3 shadow-primary/20"
        >
          <Upload className="w-4 h-4" />
          {vi.parse_secrets}
        </button>
      </div>
    </div>
  );
}
