import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD, STATE_DISABLED_OPACITY } from '@/lib/utils/designTokens';

interface StringListEditorProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  /** kebab-case suffix for `resp-list-<suffix>` testids. */
  testId: string;
}

/**
 * Minimal add/remove string-list editor. The shared catalog has no
 * list-of-strings primitive (KeyValueEditor is key/value-object shaped), so
 * this stays a feature-local row list.
 *
 * Moved here from `sub_life` when the living-agent Core surface was retired:
 * the charter editors (approval gates, event subscriptions) are now its only
 * consumers, and its testids moved from `life-core-list-*` to `resp-list-*` to
 * match. If a third feature needs it, promote it to `shared/components/forms`
 * with a `@catalog` tag rather than deep-importing from here.
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
    <div data-testid={`resp-list-${testId}`}>
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
                data-testid={`resp-list-${testId}-remove-${i}`}
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
          placeholder={t.agents.responsibilities.list_add_placeholder}
          className={INPUT_FIELD}
          data-testid={`resp-list-${testId}-input`}
        />
        <button
          type="button"
          aria-label={t.common.add}
          onClick={add}
          disabled={!pending.trim()}
          className={`shrink-0 p-2 rounded-interactive border border-primary/15 text-foreground/85 hover:text-primary hover:border-primary/30 ${STATE_DISABLED_OPACITY} transition-colors`}
          data-testid={`resp-list-${testId}-add`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
