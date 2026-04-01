import { Plus, Trash2 } from 'lucide-react';

// -- Types --------------------------------------------------------

export interface KeyValue {
  key: string;
  value: string;
}

// -- Section wrapper ----------------------------------------------

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm uppercase tracking-wider text-cyan-400/70 font-semibold">
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
            className="flex-1 px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:border-primary/25"
          />
          <input
            type="text"
            value={entry.value}
            onChange={(e) => update(i, 'value', e.target.value)}
            placeholder="value"
            className="flex-1 px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:border-primary/25"
          />
          <button
            onClick={() => remove(i)}
            className="p-1 rounded text-muted-foreground/50 hover:text-red-400/60 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1 px-2 py-1 rounded text-sm text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/30 transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add
      </button>
    </div>
  );
}

// -- Helpers ------------------------------------------------------

export function initQueryParams(endpoint: { parameters: { location: string; name: string }[] } | null): KeyValue[] {
  if (!endpoint) return [];
  const queryParams = endpoint.parameters.filter((p) => p.location === 'query');
  if (queryParams.length === 0) return [];
  return queryParams.map((p) => ({ key: p.name, value: '' }));
}

export function formatSchema(schemaJson: string): string {
  try {
    return JSON.stringify(JSON.parse(schemaJson), null, 2);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return schemaJson;
  }
}
