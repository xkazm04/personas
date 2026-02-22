import { useState } from 'react';
import { Code, Copy, Check } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/design';
import { normalizeDraftFromUnknown } from '@/features/templates/sub_n8n/n8nTypes';

interface DraftJsonTabProps {
  draftJson: string;
  draftJsonError: string | null;
  disabled: boolean;
  onJsonChange: (json: string, draft: N8nPersonaDraft | null, error: string | null) => void;
}

export function DraftJsonTab({ draftJson, draftJsonError, disabled, onJsonChange }: DraftJsonTabProps) {
  const [copied, setCopied] = useState(false);

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

  const handleCopy = () => {
    navigator.clipboard.writeText(draftJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Code className="w-3.5 h-3.5 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground/60">
            Edit raw JSON. Changes override form fields.
          </p>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg border border-primary/10 text-muted-foreground/60 hover:text-foreground/80 hover:bg-secondary/40 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <textarea
        value={draftJson}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full h-72 p-3 rounded-xl border border-primary/15 bg-background/40 text-[11px] text-foreground/85 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        disabled={disabled}
        spellCheck={false}
      />

      {draftJsonError && (
        <p className="text-xs text-red-400/80 px-1">{draftJsonError}</p>
      )}
    </div>
  );
}
