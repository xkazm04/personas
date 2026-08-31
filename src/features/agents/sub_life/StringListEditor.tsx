import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD, STATE_DISABLED_OPACITY } from '@/lib/utils/designTokens';

interface StringListEditorProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  /** kebab-case suffix for `life-core-list-<suffix>` testids. */
  testId: string;
}

/**
 * Minimal add/remove string-list editor for the Core's principles /
 * constraints / decision-principles. The catalog has no list-of-strings
 * primitive (KeyValueEditor is key/value-object shaped), so this stays a
 * feature-local row list per the brief.
 */
export function StringListEditor({ label, items, onChange, testId }: StringListEditorProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState('');

  const add = () => {
    const value = pending.trim();
    if (!value) return;
    onChange([...items, value]);
    setPending('');
  };

  return (
    <div data-testid={`life-core-list-${testId}`}>
      <p className="typo-title mb-1.5">{label}</p>
      {items.length > 0 && (
        <ul className="space-y-1 mb-1.5">
          {items.map((item, i) => (
            <li
              key={`${i}-${item}`}
              className="flex items-start gap-2 px-2.5 py-1.5 rounded-input bg-secondary/30 border border-primary/10"
            >
              <span className="typo-body flex-1 min-w-0 break-words">{item}</span>
              <button
                type="button"
                aria-label={t.common.delete}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="shrink-0 mt-0.5 text-foreground/85 hover:text-status-error transition-colors"
                data-testid={`life-core-list-${testId}-remove-${i}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={pending}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t.agents.life.core_list_placeholder}
          className={INPUT_FIELD}
          data-testid={`life-core-list-${testId}-input`}
        />
        <button
          type="button"
          aria-label={t.common.add}
          onClick={add}
          disabled={!pending.trim()}
          className={`shrink-0 p-2 rounded-interactive border border-primary/15 text-foreground/85 hover:text-primary hover:border-primary/30 ${STATE_DISABLED_OPACITY} transition-colors`}
          data-testid={`life-core-list-${testId}-add`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
