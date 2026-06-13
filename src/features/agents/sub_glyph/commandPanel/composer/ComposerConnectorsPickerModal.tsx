/**
 * ComposerConnectorsPickerModal — opens from the Composer's "Tools" row.
 *
 * Handles dozens of connectors without becoming a wall:
 *   · Autofocused search bar (type-to-filter by name + category)
 *   · Category chips at the top with live counts; "All" as default
 *   · Grid of connector cards with brand logos (meta.iconUrl) and labels
 *   · Selected state = primary ring + glow + check badge
 *   · Sticky footer tray shows "Selected: N" with a scroll of chips so
 *     the user always knows what's on deck
 *   · ⌘+Enter applies, Esc closes
 *
 * Uses healthy connectors from vault so only actually-usable choices appear.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Plug, Package, Database } from "lucide-react";
import { useHealthyConnectors } from "@/features/agents/shared/quickConfig/useHealthyConnectors";
import { DIM_META } from "@/features/shared/glyph/dimMeta";
import { ComposerPickerShell } from "./ComposerPickerShell";
import { ComposerConnectorCard } from "./ComposerConnectorCard";
import { ComposerConnectorsSearchBar } from "./ComposerConnectorsSearchBar";
import { ConnectorTableScopeRow } from "./ConnectorTableScopeRow";
import { useTranslation } from "@/i18n/useTranslation";
import { DebtText, debtText } from '@/i18n/DebtText';


interface ComposerConnectorsPickerModalProps {
  open: boolean;
  onClose: () => void;
  selected: string[];
  /** Per-database-connector table scope (connector name → tables; [] = all). */
  tables?: Record<string, string[]>;
  onApply: (next: string[], tables: Record<string, string[]>) => void;
  /** Forwarded to PickerShell — solid bg when the modal opens over a translucent surface. */
  solid?: boolean;
}

export function ComposerConnectorsPickerModal({
  open, onClose, selected, tables, onApply, solid = false,
}: ComposerConnectorsPickerModalProps) {
  const healthy = useHealthyConnectors();
  const { t, tx } = useTranslation();
  const [draft, setDraft] = useState<string[]>(selected);
  const [draftTables, setDraftTables] = useState<Record<string, string[]>>(tables ?? {});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(selected);
    setDraftTables(tables ?? {});
    setQuery("");
    setCategory("__all__");
    setFiltersOpen(false);
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, selected, tables]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of healthy) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, n]) => ({ cat, n }));
  }, [healthy]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return healthy.filter((c) => {
      if (category !== "__all__" && c.category !== category) return false;
      if (!q) return true;
      return (
        c.meta.label.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q)
      );
    });
  }, [healthy, query, category]);

  const toggleDraft = (name: string) =>
    setDraft((prev) => {
      if (prev.includes(name)) {
        // De-selecting a connector drops any table scope it carried.
        setDraftTables((tbl) => {
          if (!(name in tbl)) return tbl;
          const next = { ...tbl };
          delete next[name];
          return next;
        });
        return prev.filter((n) => n !== name);
      }
      return [...prev, name];
    });

  // Selected connectors that are databases — drive the table-scope panel.
  const selectedDbConnectors = useMemo(
    () => healthy.filter((c) => draft.includes(c.name) && c.category === "database"),
    [healthy, draft],
  );

  const applyNow = () => {
    // Only persist table scope for connectors still selected (and only
    // non-empty subsets — empty = all = no filter).
    const pruned: Record<string, string[]> = {};
    for (const name of draft) {
      const t = draftTables[name];
      if (t && t.length > 0) pruned[name] = t;
    }
    onApply(draft, pruned);
  };

  const selectedChips = useMemo(
    () =>
      draft.map((name) => {
        const match = healthy.find((h) => h.name === name);
        return { name, label: match?.meta.label ?? name, color: match?.meta.color };
      }),
    [draft, healthy],
  );

  return (
    <ComposerPickerShell
      open={open}
      onClose={onClose}
      onApply={applyNow}
      title={debtText("auto_connect_your_tools_1e2c90e0")}
      subtitle={draft.length === 0
        ? t.agents.glyph_apps_subtitle_empty
        : tx(draft.length === 1 ? t.agents.glyph_apps_selected_one : t.agents.glyph_apps_selected_other, { count: draft.length })}
      icon={<Plug className="w-5 h-5" />}
      accentColor={DIM_META.connector.color}
      size="lg"
      solid={solid}
      footer={
        <>
          <kbd className="typo-caption text-foreground"><DebtText k="auto_enter_b0d98854" /></kbd>
          <button
            type="button"
            onClick={applyNow}
            disabled={draft.length === 0 && selected.length === 0}
            className="px-4 py-1.5 rounded-interactive bg-primary/30 hover:bg-primary/50 border border-primary/50 text-foreground typo-body font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ boxShadow: "0 0 20px rgba(96,165,250,0.25)" }}
          >
            {draft.length === 0 ? t.agents.glyph_apps_clear : tx(draft.length === 1 ? t.agents.glyph_apps_attach_one : t.agents.glyph_apps_attach_other, { count: draft.length })}
          </button>
        </>
      }
    >
      <ComposerConnectorsSearchBar
        ref={inputRef}
        query={query}
        onQueryChange={setQuery}
        categories={categories}
        totalHealthy={healthy.length}
        category={category}
        onCategoryChange={setCategory}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((p) => !p)}
      />

      <div className="p-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-foreground/5 flex items-center justify-center">
              <Package className="w-6 h-6 text-foreground" />
            </div>
            <div className="typo-body text-foreground/85">
              {healthy.length === 0
                ? t.agents.glyph_apps_empty_none
                : t.agents.glyph_apps_empty_no_match}
            </div>
            {healthy.length === 0 && (
              <p className="typo-caption text-foreground max-w-xs">
                <DebtText k="auto_add_credentials_in_the_vault_then_come_bac_b79aa59c" />
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {filtered.map((c) => (
              <ComposerConnectorCard
                key={c.name}
                connector={c}
                selected={draft.includes(c.name)}
                onToggle={() => toggleDraft(c.name)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedDbConnectors.length > 0 && (
        <div className="border-t border-border/20 px-5 py-4">
          <div className="flex items-center gap-2 typo-label uppercase tracking-[0.18em] text-foreground mb-2.5">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            {t.agents.glyph_db_scope_heading}
          </div>
          <div className="flex flex-col gap-2">
            {selectedDbConnectors.map((c) => (
              <ConnectorTableScopeRow
                key={c.name}
                connector={c}
                selected={draftTables[c.name] ?? []}
                onChange={(next) =>
                  setDraftTables((prev) => ({ ...prev, [c.name]: next }))
                }
              />
            ))}
          </div>
        </div>
      )}

      {selectedChips.length > 0 && (
        <div className="sticky bottom-0 border-t border-border/20 bg-card-bg px-5 py-3">
          <div className="flex items-center gap-2 typo-label text-foreground mb-2">
            {t.agents.glyph_apps_selected_label}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {selectedChips.map((c) => (
              <span
                key={c.name}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/20 border border-primary/40 typo-caption text-foreground"
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: c.color }}
                />
                {c.label}
                <button
                  type="button"
                  onClick={() => toggleDraft(c.name)}
                  className="text-foreground hover:text-foreground -mr-0.5"
                  aria-label={tx(t.agents.glyph_apps_remove, { label: c.label })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </ComposerPickerShell>
  );
}
