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
            <h4 className="typo-heading font-semibold uppercase tracking-wider text-foreground mb-3">
              {def.sectionTitle}
            </h4>
            <textarea
              value={(state[def.key] as string) ?? ''}
              onChange={(e) => setState((prev) => ({ ...prev, [def.key]: e.target.value }))}
              placeholder={def.placeholder}
              aria-label={def.sectionTitle}
              rows={def.rows ?? 4}
              className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-modal text-foreground typo-code font-mono focus-ring focus-visible:border-primary/40 transition-all placeholder-muted-foreground/30 resize-y"
            />
            {def.helpText && <p className="mt-1 typo-body text-foreground">{def.helpText}</p>}
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
          <span className="typo-body text-foreground group-hover:text-muted-foreground/90 transition-colors">
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
  const s = t.vault.schemas;
  type Pair = { id: string; key: string; value: string };
  const pairs = (state[def.key] as Pair[]) ?? [];
  // Track which values are revealed by stable id, not array index — index keys
  // mis-attach DOM state (focus, the visibility toggle) to the wrong row after
  // a delete shifts everything down.
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  const update = useCallback(
    (next: Pair[]) => setState((prev) => ({ ...prev, [def.key]: next })),
    [def.key, setState],
  );

  const toggleVisibility = useCallback((id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <>
      <div className="border-t border-primary/8" />
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="typo-heading font-semibold uppercase tracking-wider text-foreground">
            {def.sectionTitle}
          </h4>
          <button
            type="button"
            onClick={() => update([...pairs, { id: crypto.randomUUID(), key: '', value: '' }])}
            className={`flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-modal border transition-colors ${
              def.addButtonClass ?? 'text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 border-primary/20'
            }`}
          >
            <Plus className="w-3 h-3" />
            {def.addLabel ?? s.kv_add}
          </button>
        </div>

        {pairs.length === 0 && (
          <p className="typo-body text-foreground italic">{def.emptyMessage ?? t.vault.schemas.none_configured}</p>
        )}

        <div className="space-y-2">
          {pairs.map((pair, i) => {
            const revealed = visibleIds.has(pair.id);
            return (
            <div key={pair.id} className="flex items-center gap-2">
              <input
                type="text"
                value={pair.key}
                onChange={(e) => {
                  const next = [...pairs];
                  next[i] = { ...pair, key: e.target.value };
                  update(next);
                }}
                placeholder={s.kv_key_placeholder}
                aria-label={s.kv_key_label}
                className="flex-1 px-2.5 py-1.5 bg-background/50 border border-border/50 rounded-modal typo-code text-foreground font-mono focus-ring placeholder-muted-foreground/30"
              />
              <span className="text-foreground">=</span>
              <div className="flex-1 relative">
                <input
                  type={revealed ? 'text' : 'password'}
                  value={pair.value}
                  onChange={(e) => {
                    const next = [...pairs];
                    next[i] = { ...pair, value: e.target.value };
                    update(next);
                  }}
                  placeholder={s.kv_value_placeholder}
                  aria-label={s.kv_value_label}
                  className="w-full px-2.5 py-1.5 pr-8 bg-background/50 border border-border/50 rounded-modal typo-code text-foreground font-mono focus-ring placeholder-muted-foreground/30"
                />
                <button
                  type="button"
                  onClick={() => toggleVisibility(pair.id)}
                  aria-label={revealed ? s.kv_hide_value : s.kv_show_value}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground hover:text-foreground/80 transition-colors"
                >
                  {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  update(pairs.filter((p) => p.id !== pair.id));
                  setVisibleIds((prev) => {
                    const next = new Set(prev);
                    next.delete(pair.id);
                    return next;
                  });
                }}
                aria-label={s.kv_remove}
                className="p-1 text-foreground hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
