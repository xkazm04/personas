import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import type { UseCaseInputField } from './UseCasesList';

interface StructuredFieldProps {
  field: UseCaseInputField;
  value: unknown;
  onChange: (v: unknown) => void;
}

export function StructuredField({ field, value, onChange }: StructuredFieldProps) {
  switch (field.type) {
    case 'select':
      return (
        <div className="flex items-center gap-2">
          <label className="typo-heading text-foreground w-24 flex-shrink-0">{field.label}</label>
          <ThemedSelect
            value={String(value ?? field.default ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="py-1"
            wrapperClassName="flex-1"
          >
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </ThemedSelect>
        </div>
      );
    case 'number': {
      const raw = value ?? field.default;
      const num = raw === '' || raw == null ? null : Number(raw);
      return (
        <div className="flex items-center gap-2">
          <label className="typo-heading text-foreground w-24 flex-shrink-0">{field.label}</label>
          <NumberStepper
            value={num != null && Number.isFinite(num) ? num : null}
            onChange={(v) => onChange(v == null ? '' : v)}
            allowEmpty
            ariaLabel={field.label}
            className="flex-1"
          />
        </div>
      );
    }
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <label className="typo-heading text-foreground w-24 flex-shrink-0">{field.label}</label>
          <button
            onClick={() => onChange(!value)}
            className={`px-2.5 py-1 rounded-modal typo-heading border transition-all ${
              value
                ? 'bg-primary/10 border-primary/25 text-primary'
                : 'bg-secondary/40 border-primary/10 text-foreground'
            }`}
          >
            {value ? 'Yes' : 'No'}
          </button>
        </div>
      );
    default: // text
      // A resizable textarea, not a single-line input: run inputs are commonly a
      // pasted document, transcript, or URL list — a one-line box makes those
      // unenterable (the same trap that killed the adoption brand-voice field,
      // UAT 2026-07-20). `field-sizing-content` keeps it compact for short values.
      return (
        <div className="flex items-start gap-2">
          <label className="typo-heading text-foreground w-24 flex-shrink-0 pt-1.5">{field.label}</label>
          <textarea
            value={String(value ?? field.default ?? '')}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            className="flex-1 px-2 py-1 bg-background/50 border border-primary/15 rounded-card typo-body text-foreground placeholder:text-foreground focus-ring resize-y min-h-[2rem]"
          />
        </div>
      );
  }
}
