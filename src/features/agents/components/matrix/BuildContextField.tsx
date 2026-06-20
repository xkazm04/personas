import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface BuildContextFieldProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

/**
 * Optional reference-context input on the build entry (UAT P7 — F-BUILD-NO-CONTEXT).
 * Collapsed by default so the common one-line-intent flow stays uncluttered; when
 * the user provides a writing sample / role / brand guide it flows into the build
 * prompt as grounding material so the generated persona isn't invented from the
 * intent sentence alone. Transient — used to build the prompt, not persisted.
 */
export function BuildContextField({ value, onChange, disabled }: BuildContextFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(value.trim().length > 0);
  const hasValue = value.trim().length > 0;

  return (
    <div className="rounded-card border border-border/20 bg-secondary/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left typo-body text-foreground focus-ring rounded-card"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <FileText className="w-3.5 h-3.5 text-primary" />
        <span>{t.agents.matrix_entry.context_toggle}</span>
        {hasValue && !open && (
          <span className="ml-auto typo-caption text-foreground opacity-80">
            {value.trim().length}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-1.5">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            rows={4}
            placeholder={t.agents.matrix_entry.context_placeholder}
            className="w-full resize-y rounded-input border border-border/30 bg-background/40 px-2.5 py-2 typo-body text-foreground placeholder:text-foreground placeholder:opacity-50 focus-ring disabled:opacity-60"
          />
          <p className="typo-caption text-foreground opacity-80">{t.agents.matrix_entry.context_hint}</p>
        </div>
      )}
    </div>
  );
}
