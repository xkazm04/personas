import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { queryParamDefault } from './scopeParamSeed';

// -- Types --------------------------------------------------------

export interface KeyValue {
  key: string;
  value: string;
}

// -- Section wrapper ----------------------------------------------

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="typo-heading uppercase text-cyan-400/70">
        {label}
      </span>
      {children}
    </div>
  );
}

// -- Key-Value editor ---------------------------------------------

export function KeyValueEditor({
  entries,
  onChange,
}: {
  entries: KeyValue[];
  onChange: (entries: KeyValue[]) => void;
}) {
  const update = (i: number, field: 'key' | 'value', val: string) => {
    const next = [...entries];
    next[i] = { ...next[i]!, [field]: val };
    onChange(next);
  };

  const remove = (i: number) => {
    onChange(entries.filter((_, idx) => idx !== i));
  };

  const add = () => {
    onChange([...entries, { key: '', value: '' }]);
  };

  return (
    <div className="space-y-1">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={entry.key}
            onChange={(e) => update(i, 'key', e.target.value)}
            placeholder="key"
            className="flex-1 px-2 py-1.5 rounded typo-code bg-secondary/20 border border-primary/10 text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/25"
          />
          <input
            type="text"
            value={entry.value}
            onChange={(e) => update(i, 'value', e.target.value)}
            placeholder="value"
            className="flex-1 px-2 py-1.5 rounded typo-code bg-secondary/20 border border-primary/10 text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/25"
          />
          <button
            onClick={() => remove(i)}
            className="p-1 rounded text-foreground hover:text-red-400/60 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      <AddButton onClick={add} />
    </div>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded typo-body text-foreground hover:text-muted-foreground/80 hover:bg-secondary/30 transition-colors"
    >
      <Plus className="w-3 h-3" />
      {t.vault.shared.add}
    </button>
  );
}

// -- Helpers ------------------------------------------------------

/**
 * Query rows for an endpoint, pre-filled where the catalog actually stated the
 * value. Azure DevOps rejects every request without `api-version=7.1` and the
 * catalog records that `7.1` in the parameter's description, but these rows
 * used to open empty, so the one-click test failed on a value the app already
 * had. `queryParamDefault` fills only the literal-default shape.
 */
export function initQueryParams(
  endpoint: { parameters: { location: string; name: string; required?: boolean; description?: string | null }[] } | null,
): KeyValue[] {
  if (!endpoint) return [];
  const queryParams = endpoint.parameters.filter((p) => p.location === 'query');
  if (queryParams.length === 0) return [];
  return queryParams.map((p) => ({ key: p.name, value: queryParamDefault(p) }));
}

