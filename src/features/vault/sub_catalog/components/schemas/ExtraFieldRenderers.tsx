import { useCallback, useState } from 'react';
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import type { ExtraFieldDef } from './schemaFormTypes';
import { useTranslation } from '@/i18n/useTranslation';

export function ExtraFieldRenderer({
  def,
  state,
  setState,
}: {
  def: ExtraFieldDef;
  state: Record<string, unknown>;
  setState: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}) {
  switch (def.kind) {
    case 'textarea':
      return (
        <>
          <div className="border-t border-primary/8" />
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-foreground mb-3">
              {def.sectionTitle}
            </h4>
            <textarea
              value={(state[def.key] as string) ?? ''}
              onChange={(e) => setState((prev) => ({ ...prev, [def.key]: e.target.value }))}
              placeholder={def.placeholder}
              rows={def.rows ?? 4}
              className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-modal text-foreground text-sm font-mono focus-ring focus-visible:border-primary/40 transition-all placeholder-muted-foreground/30 resize-y"
            />
            {def.helpText && <p className="mt-1 text-sm text-foreground">{def.helpText}</p>}
          </div>
        </>
      );

    case 'checkbox':
      return (
        <label className="flex items-center gap-2 mt-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={(state[def.key] as boolean) ?? false}
            onChange={(e) => setState((prev) => ({ ...prev, [def.key]: e.target.checked }))}
            className="w-3.5 h-3.5 rounded border-border/50 bg-background/50 text-primary focus-visible:ring-primary/40"
          />
          <span className="text-sm text-foreground group-hover:text-muted-foreground/90 transition-colors">
            {def.label}
          </span>
        </label>
      );

    case 'key-value-list':
      return <KeyValueListField def={def} state={state} setState={setState} />;
  }
}

function KeyValueListField({
  def,
  state,
  setState,
}: {
  def: Extract<ExtraFieldDef, { kind: 'key-value-list' }>;
  state: Record<string, unknown>;
  setState: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}) {
  const { t } = useTranslation();
  const pairs = (state[def.key] as { key: string; value: string }[]) ?? [];
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(new Set());

  const update = useCallback(
    (next: { key: string; value: string }[]) => setState((prev) => ({ ...prev, [def.key]: next })),
    [def.key, setState],
  );

  const toggleVisibility = useCallback((index: number) => {
    setVisibleIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  return (
    <>
      <div className="border-t border-primary/8" />
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            {def.sectionTitle}
          </h4>
          <button
            onClick={() => update([...pairs, { key: '', value: '' }])}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-modal border transition-colors ${
              def.addButtonClass ?? 'text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 border-primary/20'
            }`}
          >
            <Plus className="w-3 h-3" />
            {def.addLabel ?? 'Add'}
          </button>
        </div>

        {pairs.length === 0 && (
          <p className="text-sm text-foreground italic">{def.emptyMessage ?? t.vault.schemas.none_configured}</p>
        )}

        <div className="space-y-2">
          {pairs.map((pair, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={pair.key}
                onChange={(e) => {
                  const next = [...pairs];
                  next[i] = { ...pair, key: e.target.value };
                  update(next);
                }}
                placeholder="KEY"
                className="flex-1 px-2.5 py-1.5 bg-background/50 border border-border/50 rounded-modal text-sm text-foreground font-mono focus-ring placeholder-muted-foreground/30"
              />
              <span className="text-foreground">=</span>
              <div className="flex-1 relative">
                <input
                  type={visibleIndices.has(i) ? 'text' : 'password'}
                  value={pair.value}
                  onChange={(e) => {
                    const next = [...pairs];
                    next[i] = { ...pair, value: e.target.value };
                    update(next);
                  }}
                  placeholder="value"
                  className="w-full px-2.5 py-1.5 pr-8 bg-background/50 border border-border/50 rounded-modal text-sm text-foreground font-mono focus-ring placeholder-muted-foreground/30"
                />
                <button
                  type="button"
                  onClick={() => toggleVisibility(i)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground hover:text-foreground/80 transition-colors"
                >
                  {visibleIndices.has(i) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                onClick={() => {
                  update(pairs.filter((_, j) => j !== i));
                  setVisibleIndices((prev) => {
                    const next = new Set<number>();
                    for (const idx of prev) {
                      if (idx < i) next.add(idx);
                      else if (idx > i) next.add(idx - 1);
                    }
                    return next;
                  });
                }}
                className="p-1 text-foreground hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
