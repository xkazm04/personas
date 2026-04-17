import { TriggerFieldGroup } from './TriggerFieldGroup';
import { useTranslation } from '@/i18n/useTranslation';

export interface ClipboardConfigProps {
  clipboardContentType: string;
  setClipboardContentType: (v: string) => void;
  clipboardPattern: string;
  setClipboardPattern: (v: string) => void;
  clipboardInterval: string;
  setClipboardInterval: (v: string) => void;
}

export function ClipboardConfig({
  clipboardContentType, setClipboardContentType,
  clipboardPattern, setClipboardPattern,
  clipboardInterval, setClipboardInterval,
}: ClipboardConfigProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <TriggerFieldGroup label={t.triggers.clipboard.content_type}>
        <div className="flex gap-1.5">
          {(['text', 'image', 'any'] as const).map((ct) => (
            <button
              key={ct}
              type="button"
              onClick={() => setClipboardContentType(ct)}
              className={`px-3 py-1.5 rounded-modal typo-body font-medium transition-all border capitalize ${
                clipboardContentType === ct
                  ? 'bg-pink-500/15 text-pink-400 border-pink-500/30'
                  : 'bg-secondary/30 text-foreground border-border/30 hover:bg-secondary/50'
              }`}
            >
              {ct}
            </button>
          ))}
        </div>
      </TriggerFieldGroup>
      <TriggerFieldGroup
        label={<>{t.triggers.text_pattern_label} <span className="text-foreground">{t.triggers.optional_regex_label}</span></>}
        helpText={t.triggers.text_pattern_help}
      >
        <input
          type="text"
          value={clipboardPattern}
          onChange={(e) => setClipboardPattern(e.target.value)}
          placeholder="e.g. https?://.* or error|exception"
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground font-mono typo-code placeholder-muted-foreground/30 focus-ring transition-all"
        />
      </TriggerFieldGroup>
      <TriggerFieldGroup label={t.triggers.poll_interval_label}>
        <input
          type="number"
          value={clipboardInterval}
          onChange={(e) => setClipboardInterval(e.target.value)}
          min="2"
          className="w-24 px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground font-mono typo-code focus-ring transition-all"
        />
      </TriggerFieldGroup>
    </div>
  );
}
