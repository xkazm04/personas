/**
 * ScanConfigModal — full-page scan configuration for the Idea Scanner.
 *
 * Two settings:
 *  1. **Context scope** — restrict the scan to selected context groups /
 *     contexts (the agents then analyze ONLY those areas). Selecting a group
 *     toggles all its contexts. Only shown once a codebase has been mapped.
 *  2. **Granularity** — a target number of findings per scanned area, injected
 *     into the scan prompt (quality stays the gate).
 *
 * The selection is resolved to context ids and passed back via `onApply`; the
 * page threads them through `runScan` → `dev_tools_run_scan`.
 */
import { useMemo, useState } from 'react';
import { ScanSearch, X, Check, Minus, FolderTree, Target } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

const GRANULARITY_PRESETS = [3, 5, 8, 12];

export function ScanConfigModal({
  open, onClose, initialContextIds, initialTargetCount, onApply,
}: {
  open: boolean;
  onClose: () => void;
  initialContextIds: string[];
  initialTargetCount: number | null;
  onApply: (contextIds: string[], targetCount: number | null) => void;
}) {
  const { t, tx } = useTranslation();
  const ds = t.plugins.dev_scanner;
  const groups = useSystemStore((s) => s.contextGroups);
  const contexts = useSystemStore((s) => s.contexts);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialContextIds));
  const [target, setTarget] = useState<number | null>(initialTargetCount);

  const contextsByGroup = useMemo(() => {
    const map = new Map<string, typeof contexts>();
    for (const c of contexts) {
      const key = c.group_id ?? '__ungrouped__';
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return map;
  }, [contexts]);

  const toggleContext = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const groupState = (ids: string[]): 'all' | 'some' | 'none' => {
    const inSel = ids.filter((id) => selected.has(id)).length;
    if (inSel === 0) return 'none';
    return inSel === ids.length ? 'all' : 'some';
  };

  const toggleGroup = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const state = groupState(ids);
      if (state === 'all') ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });

  const hasContexts = contexts.length > 0;
  const ungrouped = contextsByGroup.get('__ungrouped__') ?? [];

  const apply = () => {
    onApply([...selected], target);
    onClose();
  };

  if (!open) return null;

  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="scan-config" maxWidthClass="max-w-4xl">
      <div className="flex flex-col max-h-[85vh]">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border shrink-0">
          <ScanSearch className="w-4 h-4 text-amber-400" />
          <h2 id="scan-config" className="typo-heading text-foreground flex-1">{ds.scan_config_title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.cancel} className="p-1 rounded-interactive text-foreground hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">
          {/* Granularity */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-3.5 h-3.5 text-amber-400/80" />
              <h3 className="typo-label text-primary uppercase tracking-wider">{ds.scan_config_granularity_label}</h3>
            </div>
            <p className="typo-caption text-foreground mb-2.5">{ds.scan_config_granularity_hint}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="xs" onClick={() => setTarget(null)} className={target === null ? 'border bg-primary/15 border-primary/30 text-primary' : ''}>
                {ds.scan_config_granularity_auto}
              </Button>
              {GRANULARITY_PRESETS.map((n) => (
                <Button key={n} variant="ghost" size="xs" onClick={() => setTarget(n)} className={target === n ? 'border bg-primary/15 border-primary/30 text-primary' : ''}>
                  {n}
                </Button>
              ))}
              <input
                type="number"
                min={1}
                max={50}
                value={target ?? ''}
                onChange={(e) => setTarget(e.target.value ? Math.max(1, Math.min(50, Number(e.target.value))) : null)}
                placeholder={ds.scan_config_granularity_auto}
                className="w-20 px-2.5 py-1 typo-body bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground/40 focus-ring tabular-nums"
              />
            </div>
          </section>

          {/* Context scope */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <FolderTree className="w-3.5 h-3.5 text-amber-400/80" />
              <h3 className="typo-label text-primary uppercase tracking-wider">{ds.scan_config_scope_label}</h3>
              {selected.size > 0 && (
                <span className="typo-caption text-primary tabular-nums">{tx(ds.scan_config_selected_count, { count: selected.size })}</span>
              )}
              {selected.size > 0 && (
                <button type="button" onClick={() => setSelected(new Set())} className="ml-auto typo-caption text-foreground hover:text-foreground/70 transition-colors">
                  {ds.scan_config_clear}
                </button>
              )}
            </div>
            <p className="typo-caption text-foreground mb-2.5">{ds.scan_config_scope_hint}</p>

            {!hasContexts ? (
              <p className="typo-caption text-foreground italic py-4 text-center border border-dashed border-primary/10 rounded-card">{ds.scan_config_scope_empty}</p>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => {
                  const list = contextsByGroup.get(g.id) ?? [];
                  if (list.length === 0) return null;
                  const ids = list.map((c) => c.id);
                  const state = groupState(ids);
                  return (
                    <ScopeGroup key={g.id} label={g.name} state={state} onToggle={() => toggleGroup(ids)}>
                      {list.map((c) => (
                        <ScopeRow key={c.id} label={c.name} checked={selected.has(c.id)} onToggle={() => toggleContext(c.id)} />
                      ))}
                    </ScopeGroup>
                  );
                })}
                {ungrouped.length > 0 && (
                  <ScopeGroup
                    label={ds.scan_config_ungrouped}
                    state={groupState(ungrouped.map((c) => c.id))}
                    onToggle={() => toggleGroup(ungrouped.map((c) => c.id))}
                  >
                    {ungrouped.map((c) => (
                      <ScopeRow key={c.id} label={c.name} checked={selected.has(c.id)} onToggle={() => toggleContext(c.id)} />
                    ))}
                  </ScopeGroup>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-border shrink-0">
          <span className="typo-caption text-foreground">
            {selected.size === 0 ? ds.scan_config_whole_project : tx(ds.scan_config_selected_count, { count: selected.size })}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{t.common.cancel}</Button>
            <Button variant="accent" accentColor="amber" size="sm" onClick={apply}>{ds.scan_config_apply}</Button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}

function ScopeGroup({ label, state, onToggle, children }: {
  label: string; state: 'all' | 'some' | 'none'; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-primary/10 bg-card/30 overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-primary/5 transition-colors text-left">
        <CheckBox state={state} />
        <span className="typo-body font-medium text-foreground">{label}</span>
      </button>
      <div className="pl-6 pr-3 pb-2 space-y-0.5">{children}</div>
    </div>
  );
}

function ScopeRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="w-full flex items-center gap-2.5 px-2 py-1 rounded-interactive hover:bg-primary/5 transition-colors text-left">
      <CheckBox state={checked ? 'all' : 'none'} />
      <span className="typo-caption text-foreground truncate">{label}</span>
    </button>
  );
}

function CheckBox({ state }: { state: 'all' | 'some' | 'none' }) {
  return (
    <span className={`w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0 transition-colors ${
      state === 'none' ? 'border-primary/25' : 'border-primary/40 bg-primary/20'
    }`}>
      {state === 'all' && <Check className="w-3 h-3 text-primary" />}
      {state === 'some' && <Minus className="w-3 h-3 text-primary" />}
    </span>
  );
}
