import { Code } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/design';
import { normalizeDraftFromUnknown } from '@/features/templates/sub_n8n/n8nTypes';

interface DraftJsonTabProps {
  draftJson: string;
  draftJsonError: string | null;
  disabled: boolean;
  onJsonChange: (json: string, draft: N8nPersonaDraft | null, error: string | null) => void;
}

export function DraftJsonTab({ draftJson, draftJsonError, disabled, onJsonChange }: DraftJsonTabProps) {
  const handleChange = (value: string) => {
    try {
      const parsed = normalizeDraftFromUnknown(JSON.parse(value));
      if (!parsed) {
        onJsonChange(value, null, 'JSON does not match expected persona draft shape.');
        return;
      }
      onJsonChange(value, parsed, null);
    } catch {
      onJsonChange(value, null, 'Invalid JSON syntax.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Code className="w-3.5 h-3.5 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground/50">
          Edit the raw JSON directly. Changes here override the form fields.
        </p>
      </div>

      <textarea
        value={draftJson}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full h-72 p-3 rounded-xl border border-primary/15 bg-background/40 text-[11px] text-foreground/75 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        disabled={disabled}
        spellCheck={false}
      />

      {draftJsonError && (
        <p className="text-xs text-red-400/80 px-1">{draftJsonError}</p>
      )}
    </div>
  );
}
