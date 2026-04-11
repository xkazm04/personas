import { useState } from 'react';
import { Plus, HelpCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { FormField } from '@/features/shared/components/forms/FormField';
import { inputFieldClass } from '@/lib/utils/designTokens';
import { getEventTypeOptionsGrouped, getSourceFilterHelp } from '@/lib/eventTypeTaxonomy';
import { useTranslation } from '@/i18n/useTranslation';

interface AddSubscriptionFormProps {
  onAdd: (eventType: string, sourceFilter: string) => Promise<void>;
  onCancel: () => void;
}

export function AddSubscriptionForm({ onAdd, onCancel }: AddSubscriptionFormProps) {
  const { t } = useTranslation();
  const [newEventType, setNewEventType] = useState('');
  const [newSourceFilter, setNewSourceFilter] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const groupedOptions = getEventTypeOptionsGrouped(t);
  const sourceFilterHelp = getSourceFilterHelp(t);

  const sanitizeSourceFilter = (value: string): string => {
    // Normalize visually-similar unicode and collapse wildcard runs.
    return value.normalize('NFKC').trim().replace(/\*{2,}/g, '*');
  };

  const validateSourceFilter = (value: string): string | null => {
    if (!value) return null;
    if (value === '*') return 'A global wildcard (*) is too broad. Use a scoped prefix such as team-*.';
    if (value.length > 120) return 'Source filter is too long (max 120 chars).';
    if (/\*\*/.test(value)) return 'Double wildcard (**) is not allowed.';
    if (/\?/.test(value)) return 'Question-mark wildcards are not allowed.';
    if (!/^[a-zA-Z0-9_:\-*.]+$/.test(value)) return 'Only letters, numbers, _, -, :, ., and * are allowed.';
    if (value.startsWith('.') || value.endsWith('.')) return 'Source filter cannot start or end with a dot.';
    if (/\.\.|::|:\.|\.:(?=.)/.test(value)) return 'Source filter contains an invalid separator sequence.';
    if (value.split('*').length - 1 > 3) return 'At most 3 wildcard characters are allowed.';
    return null;
  };

  const handleAdd = async () => {
    if (!newEventType) return;
    const sourceFilter = sanitizeSourceFilter(newSourceFilter);
    const error = validateSourceFilter(sourceFilter);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    setSaving(true);
    try {
      await onAdd(newEventType, sourceFilter);
      setNewEventType('');
      setNewSourceFilter('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-primary/20 rounded-xl p-2.5 space-y-2 bg-secondary/30">
      <FormField label="Event Type" hint="The type of system event that will trigger this persona to run.">
        <ThemedSelect
          value={newEventType}
          onChange={(e) => setNewEventType(e.target.value)}
          className="py-1.5"
        >
          <option value="">Select event type...</option>
          {groupedOptions.map((group) => (
            <optgroup key={group.category} label={group.label}>
              {group.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </optgroup>
          ))}
        </ThemedSelect>
      </FormField>
      <FormField label="Source Filter" error={validationError ?? undefined} helpText="Narrow events by source_id. Exact match or trailing * prefix wildcard.">
        {(inputProps) => (
          <div className="space-y-1.5">
            <input
              {...inputProps}
              type="text"
              value={newSourceFilter}
              onChange={(e) => {
                setNewSourceFilter(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="e.g. webhook-1 or watcher-*"
              className={inputFieldClass(!!validationError)}
            />
            <details className="group">
              <summary className="flex items-center gap-1 text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground/80 transition-colors">
                <HelpCircle className="w-3 h-3" />
                {sourceFilterHelp.title}
              </summary>
              <div className="mt-1 p-2 rounded-lg bg-background/40 border border-primary/10 text-xs text-muted-foreground/70 space-y-1">
                {sourceFilterHelp.rules.map((r) => (
                  <div key={r.pattern} className="flex gap-2">
                    <code className="text-primary/80 shrink-0">{r.pattern}</code>
                    <span>{r.explanation}</span>
                  </div>
                ))}
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  {sourceFilterHelp.constraints.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            </details>
          </div>
        )}
      </FormField>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => void handleAdd()}
          disabled={!newEventType || saving}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
            newEventType && !saving
              ? 'bg-primary hover:bg-primary/90 text-foreground'
              : 'bg-secondary/40 text-muted-foreground/80 cursor-not-allowed'
          }`}
        >
          {saving ? <LoadingSpinner size="sm" /> : <Plus className="w-3.5 h-3.5" />}
          Add
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-foreground/95 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
