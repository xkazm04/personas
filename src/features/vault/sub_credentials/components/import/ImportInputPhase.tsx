import { ArrowLeft, Upload, Terminal } from 'lucide-react';
import { IMPORT_SOURCES, type ImportSourceId } from './importTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface ImportInputPhaseProps {
  sourceId: ImportSourceId;
  rawInput: string;
  onInputChange: (value: string) => void;
  onParse: () => void;
  onBack: () => void;
}

export function ImportInputPhase({ sourceId, rawInput, onInputChange, onParse, onBack }: ImportInputPhaseProps) {
  const { t, tx } = useTranslation();
  const vi = t.vault.import;
  const source = IMPORT_SOURCES.find((s) => s.id === sourceId)!;

  const placeholder = sourceId === 'env_file'
    ? 'OPENAI_API_KEY=sk-...\nGITHUB_TOKEN=ghp_...\nSTRIPE_SECRET_KEY=sk_live_...'
    : sourceId === '1password'
    ? 'Paste output of: op item list --format=json'
    : sourceId === 'aws_secrets'
    ? 'Paste output of: aws secretsmanager get-secret-value --secret-id <name>'
    : sourceId === 'azure_keyvault'
    ? 'Paste output of: az keyvault secret show --vault-name <vault> --name <secret>'
    : 'Paste output of: doppler secrets download --format=json';

  const cliHint = source.cliCommand
    ? `Run the ${source.cliCommand} CLI command and paste the JSON output below.`
    : 'Paste your .env file contents below.';

  return (
    <div
      className="animate-fade-slide-in space-y-4"
    >
      <div className="flex items-center gap-2">
        <button
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
          <h3 className="typo-body font-medium text-foreground">{tx(t.vault.credential_import.import_from, { source: source.label })}</h3>
          <p className="typo-body text-foreground">{cliHint}</p>
        </div>
      </div>

      <textarea
        value={rawInput}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={placeholder}
        rows={10}
        autoFocus
        className="w-full px-4 py-3 bg-secondary/40 border border-primary/15 rounded-modal text-foreground typo-code font-mono placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all resize-none"
      />

      <div className="flex justify-end">
        <button
          onClick={onParse}
          disabled={!rawInput.trim()}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-foreground rounded-modal typo-body font-medium transition-all shadow-elevation-3 shadow-primary/20"
        >
          <Upload className="w-4 h-4" />
          {vi.parse_secrets}
        </button>
      </div>
    </div>
  );
}
