import { FileText, KeyRound, Cloud, Shield, Lock, ArrowLeft } from 'lucide-react';
import { IMPORT_SOURCES, type ImportSourceId } from './importTypes';
import { useTranslation } from '@/i18n/useTranslation';

const ICON_MAP: Record<string, React.FC<{ className?: string; style?: React.CSSProperties }>> = {
  'file-text': FileText,
  'key-round': KeyRound,
  'cloud': Cloud,
  'shield': Shield,
  'lock': Lock,
};

interface ImportSourcePickerProps {
  onSelect: (sourceId: ImportSourceId) => void;
  onBack: () => void;
}

export function ImportSourcePicker({ onSelect, onBack }: ImportSourcePickerProps) {
  const { t } = useTranslation();
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
        <div>
          <h3 className="text-sm font-medium text-foreground">{t.vault.credential_import.import_from_vault}</h3>
          <p className="text-sm text-foreground">{t.vault.credential_import.import_subtitle}</p>
        </div>
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {IMPORT_SOURCES.map((source) => {
          const Icon = ICON_MAP[source.icon] ?? FileText;
          return (
            <button
              key={source.id}
              onClick={() => onSelect(source.id)}
              className="flex items-start gap-3 p-3 rounded-modal border border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20 transition-all text-left group"
            >
              <div
                className="w-9 h-9 rounded-card border flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ backgroundColor: `${source.color}12`, borderColor: `${source.color}30` }}
              >
                <Icon className="w-4.5 h-4.5" style={{ color: source.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  {source.label}
                </p>
                <p className="text-sm text-foreground leading-snug">{source.description}</p>
                {source.syncSupported && (
                  <span className="inline-block mt-1 px-1.5 py-0.5 text-[11px] rounded-input bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    Sync supported
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
