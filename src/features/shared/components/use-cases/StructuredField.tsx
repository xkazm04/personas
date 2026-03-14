import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
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
          <label className="text-sm font-medium text-muted-foreground/70 w-24 flex-shrink-0">{field.label}</label>
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
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground/70 w-24 flex-shrink-0">{field.label}</label>
          <input
            type="number"
            value={String(value ?? field.default ?? '')}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            className="flex-1 px-2 py-1 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus-ring"
          />
        </div>
      );
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground/70 w-24 flex-shrink-0">{field.label}</label>
          <button
            onClick={() => onChange(!value)}
            className={`px-2.5 py-1 rounded-xl text-sm font-medium border transition-all ${
              value
                ? 'bg-primary/10 border-primary/25 text-primary'
                : 'bg-secondary/40 border-primary/10 text-muted-foreground/80'
            }`}
          >
            {value ? 'Yes' : 'No'}
          </button>
        </div>
      );
    default: // text
      return (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground/70 w-24 flex-shrink-0">{field.label}</label>
          <input
            type="text"
            value={String(value ?? field.default ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 px-2 py-1 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/40 focus-ring"
          />
        </div>
      );
  }
}
