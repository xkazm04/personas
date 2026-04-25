/**
 * ResourcePicker — post-credential-save scope selection.
 *
 * Walks each resource spec declared on the connector's `resources[]`, fetches
 * live picker items via `list_connector_resources`, renders a searchable
 * multi-select per spec, and persists user picks to
 * `persona_credentials.scoped_resources`.
 *
 * Chained resources (`depends_on`) are fetched sequentially — earlier picks
 * feed into later endpoints' template vars.
 *
 * Skipping saves `{}` (distinct from never-prompted `null`) so we can tell
 * "user declined" from "never shown".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Check, RefreshCw, AlertTriangle, X } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import type { ResourceSpec } from '@/lib/types/types';
import {
  listConnectorResources,
  saveScopedResources,
  type ResourceItem,
  type ScopedResources,
} from '@/api/credentials/scopedResources';
import { toastCatch } from '@/lib/silentCatch';

interface Props {
  credentialId: string;
  connectorLabel: string;
  specs: ResourceSpec[];
  /** Current picks — pre-fills the selection when editing an existing scope. */
  initial?: ScopedResources | null;
  onClose: () => void;
  /** Called after a successful save (broad skip or committed picks). */
  onCommit?: (scope: ScopedResources) => void;
}

type FetchState = {
  loading: boolean;
  items: ResourceItem[];
  error: string | null;
  /** True after the first successful fetch — gates stale detection. */
  fetched: boolean;
};

export function ResourcePicker({
  credentialId,
  connectorLabel,
  specs,
  initial,
  onClose,
  onCommit,
}: Props) {
  const [state, setState] = useState<Record<string, FetchState>>({});
  const [selections, setSelections] = useState<ScopedResources>(initial ?? {});
  const [search, setSearch] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Order specs so dependencies resolve first.
  const orderedSpecs = useMemo(() => topoSortSpecs(specs), [specs]);

  const fetchSpec = useCallback(
    async (spec: ResourceSpec, bypassCache = false) => {
      // Gate on any unresolved depends_on
      for (const dep of spec.depends_on ?? []) {
        if (!selections[dep]?.length) {
          setState((s) => ({
            ...s,
            [spec.id]: {
              loading: false,
              items: [],
              error: `Pick a ${dep} first`,
              fetched: false,
            },
          }));
          return;
        }
      }

      setState((s) => ({
        ...s,
        [spec.id]: { ...(s[spec.id] ?? { items: [], error: null, fetched: false }), loading: true, error: null },
      }));

      try {
        const ctx: Record<string, unknown> = {};
        for (const dep of spec.depends_on ?? []) {
          const first = selections[dep]?.[0];
          if (first) ctx[dep] = first;
        }
        const items = await listConnectorResources(credentialId, spec.id, ctx, bypassCache);
        setState((s) => ({
          ...s,
          [spec.id]: { loading: false, items, error: null, fetched: true },
        }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({
          ...s,
          [spec.id]: { loading: false, items: [], error: msg, fetched: false },
        }));
      }
    },
    [credentialId, selections],
  );

  // Fetch each spec once its dependencies are resolved.
  useEffect(() => {
    for (const spec of orderedSpecs) {
      if (state[spec.id]) continue;
      const depsReady = (spec.depends_on ?? []).every((d) => selections[d]?.length);
      if (!depsReady && (spec.depends_on ?? []).length > 0) continue;
      void fetchSpec(spec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedSpecs, selections]);

  const toggleItem = (spec: ResourceSpec, item: ResourceItem) => {
    setSelections((prev) => {
      const current = prev[spec.id] ?? [];
      const existing = current.find((x) => x.id === item.id);
      let next: ResourceItem[];
      if (existing) {
        next = current.filter((x) => x.id !== item.id);
      } else if (spec.selection === 'single' || spec.selection === 'single_or_all') {
        next = [item];
      } else {
        next = [...current, item];
      }
      const out = { ...prev, [spec.id]: next };
      // Clear downstream picks if a depends_on choice changed
      for (const other of orderedSpecs) {
        if ((other.depends_on ?? []).includes(spec.id)) {
          delete out[other.id];
        }
      }
      return out;
    });
  };

  const isSelected = (specId: string, id: string) =>
    !!selections[specId]?.some((x) => x.id === id);

  const handleCommit = async (scope: ScopedResources) => {
    setSaving(true);
    try {
      await saveScopedResources(credentialId, scope);
      onCommit?.(scope);
      onClose();
    } catch (e) {
      toastCatch('save scope')(e);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => handleCommit({});
  const handleSave = () => handleCommit(selections);

  const requiredMissing = orderedSpecs.some(
    (s) => s.required && !selections[s.id]?.length,
  );

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="resource-picker-title"
      containerClassName="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      maxWidthClass="max-w-3xl"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden max-h-[90vh]"
    >
      <div data-testid="resource-picker" className="contents" />
      <header className="px-6 pt-5 pb-4 border-b border-primary/10 flex items-start justify-between gap-3">
        <div>
          <h2 id="resource-picker-title" className="typo-heading-md text-foreground">
            Scope {connectorLabel}
          </h2>
          <p className="typo-body-sm text-foreground/60 mt-1">
            Narrow this credential to specific resources. Templates that ask for a
            scoped resource will auto-fill your picks.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-foreground/50 hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {orderedSpecs.map((spec) => {
          const st = state[spec.id] ?? { loading: false, items: [], error: null, fetched: false };
          const q = (search[spec.id] ?? '').toLowerCase();
          const visible = q
            ? st.items.filter(
                (x) =>
                  x.label.toLowerCase().includes(q) ||
                  (x.sublabel ?? '').toLowerCase().includes(q) ||
                  x.id.toLowerCase().includes(q),
              )
            : st.items;
          const picked = selections[spec.id] ?? [];
          // Picks that don't appear in the freshly-fetched list — most often
          // because the resource was deleted upstream, or the credential lost
          // access to it. Only computed once we have a real response (not on
          // load or error) so a transient zero-results state doesn't flag
          // every pick as stale.
          const stalePicks = st.fetched
            ? picked.filter((p) => !st.items.some((i) => i.id === p.id))
            : [];
          const dropStale = () =>
            setSelections((prev) => ({
              ...prev,
              [spec.id]: (prev[spec.id] ?? []).filter(
                (p) => !stalePicks.some((s) => s.id === p.id),
              ),
            }));
          return (
            <section key={spec.id}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="typo-body font-medium text-foreground">
                    {spec.label}
                    {spec.required && (
                      <span className="ml-1.5 text-status-warning">*</span>
                    )}
                  </h3>
                  {spec.description && (
                    <p className="typo-caption text-foreground/60 mt-0.5">
                      {spec.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {picked.length > 0 && (
                    <span className="typo-caption text-foreground/60">
                      {picked.length} picked
                    </span>
                  )}
                  <button
                    onClick={() => fetchSpec(spec, true)}
                    className="p-1.5 rounded-interactive hover:bg-foreground/5 text-foreground/60 hover:text-foreground transition-colors"
                    title="Refresh"
                    disabled={st.loading}
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${st.loading ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>
              </div>

              {st.error && (
                <div className="mb-2 px-3 py-2 rounded-input bg-status-warning/10 border border-status-warning/30 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-status-warning mt-0.5" />
                  <p className="typo-caption text-status-warning">{st.error}</p>
                </div>
              )}

              {stalePicks.length > 0 && (
                <div
                  data-testid={`resource-stale-${spec.id}`}
                  className="mb-2 px-3 py-2 rounded-input bg-status-warning/10 border border-status-warning/30 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-status-warning mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="typo-caption text-status-warning font-medium">
                      {stalePicks.length} pick{stalePicks.length === 1 ? '' : 's'} no longer exist
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {stalePicks.map((p) => (
                        <span
                          key={p.id}
                          className="typo-caption px-2 py-0.5 rounded bg-status-warning/20 text-status-warning line-through"
                          title={p.id}
                        >
                          {p.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={dropStale}
                    data-testid={`resource-drop-stale-${spec.id}`}
                    className="typo-caption px-2 py-1 rounded-interactive bg-status-warning/20 hover:bg-status-warning/30 text-status-warning transition-colors flex-shrink-0"
                  >
                    Drop stale
                  </button>
                </div>
              )}

              {!st.error && (
                <>
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
                    <input
                      type="text"
                      value={search[spec.id] ?? ''}
                      onChange={(e) =>
                        setSearch((s) => ({ ...s, [spec.id]: e.target.value }))
                      }
                      placeholder={`Search ${spec.label.toLowerCase()}…`}
                      className="w-full pl-8 pr-3 py-1.5 typo-body-sm bg-secondary/50 border border-border rounded-input text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-border rounded-input bg-secondary/20 divide-y divide-border">
                    {st.loading && (
                      <p className="px-3 py-2 typo-caption text-foreground/40">
                        Loading…
                      </p>
                    )}
                    {!st.loading && visible.length === 0 && (
                      <p className="px-3 py-2 typo-caption text-foreground/40">
                        {q ? 'No matches' : 'Nothing to pick yet'}
                      </p>
                    )}
                    {visible.map((item) => {
                      const sel = isSelected(spec.id, item.id);
                      return (
                        <button
                          key={item.id}
                          onClick={() => toggleItem(spec, item)}
                          data-testid={`resource-pick-${spec.id}-${item.id}`}
                          className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-foreground/5 transition-colors ${
                            sel ? 'bg-primary/5' : ''
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                              sel
                                ? 'bg-primary border-primary'
                                : 'border-foreground/30'
                            }`}
                          >
                            {sel && <Check className="w-3 h-3 text-background" />}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="typo-body-sm text-foreground truncate block">
                              {item.label}
                            </span>
                            {item.sublabel && (
                              <span className="typo-caption text-foreground/50 truncate block">
                                {item.sublabel}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>

      <footer className="px-6 py-4 border-t border-primary/10 flex items-center justify-between gap-3">
        <button
          onClick={handleSkip}
          disabled={saving}
          data-testid="resource-picker-skip"
          className="typo-body-sm text-foreground/60 hover:text-foreground transition-colors disabled:opacity-50"
        >
          Skip — use broad scope
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            data-testid="resource-picker-cancel"
            className="px-4 py-1.5 rounded-interactive border border-border hover:bg-foreground/5 typo-body-sm text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || requiredMissing}
            data-testid="resource-picker-save"
            className="px-4 py-1.5 rounded-interactive bg-primary hover:bg-primary/90 typo-body-sm text-background transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save scope'}
          </button>
        </div>
      </footer>
    </BaseModal>
  );
}

/** Sort specs so each spec appears after any spec it depends on. */
function topoSortSpecs(specs: ResourceSpec[]): ResourceSpec[] {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const out: ResourceSpec[] = [];
  const visit = (s: ResourceSpec) => {
    if (visited.has(s.id)) return;
    visited.add(s.id);
    for (const dep of s.depends_on ?? []) {
      const d = byId.get(dep);
      if (d) visit(d);
    }
    out.push(s);
  };
  for (const s of specs) visit(s);
  return out;
}
