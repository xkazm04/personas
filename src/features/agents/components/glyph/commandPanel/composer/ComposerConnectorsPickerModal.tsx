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
import { Plug, Package } from "lucide-react";
import { useHealthyConnectors } from "@/features/agents/components/matrix/useHealthyConnectors";
import { ComposerPickerShell } from "./ComposerPickerShell";
import { ComposerConnectorCard } from "./ComposerConnectorCard";
import { ComposerConnectorsSearchBar } from "./ComposerConnectorsSearchBar";

interface ComposerConnectorsPickerModalProps {
  open: boolean;
  onClose: () => void;
  selected: string[];
  onApply: (next: string[]) => void;
}

export function ComposerConnectorsPickerModal({
  open, onClose, selected, onApply,
}: ComposerConnectorsPickerModalProps) {
  const healthy = useHealthyConnectors();
  const [draft, setDraft] = useState<string[]>(selected);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(selected);
      setQuery("");
      setCategory("__all__");
      setFiltersOpen(false);
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open, selected]);

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
    setDraft((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const applyNow = () => onApply(draft);

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
      title="Connect your tools"
      subtitle={draft.length === 0
        ? "Search or filter to pick apps from your vault"
        : `${draft.length} app${draft.length === 1 ? "" : "s"} selected`}
      icon={<Plug className="w-5 h-5" />}
      size="lg"
      footer={
        <>
          <kbd className="typo-caption text-foreground/50">⌘ + Enter</kbd>
          <button
            type="button"
            onClick={applyNow}
            disabled={draft.length === 0 && selected.length === 0}
            className="px-4 py-1.5 rounded-interactive bg-primary/30 hover:bg-primary/50 border border-primary/50 text-foreground typo-body font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ boxShadow: "0 0 20px rgba(96,165,250,0.25)" }}
          >
            {draft.length === 0 ? "Clear selection" : `Attach ${draft.length} app${draft.length === 1 ? "" : "s"}`}
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
              <Package className="w-6 h-6 text-foreground/50" />
            </div>
            <div className="typo-body text-foreground/85">
              {healthy.length === 0
                ? "No connected apps in the vault yet."
                : "No matches — try a different search."}
            </div>
            {healthy.length === 0 && (
              <p className="typo-caption text-foreground/65 max-w-xs">
                Add credentials in the vault, then come back here to attach them.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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

      {selectedChips.length > 0 && (
        <div className="sticky bottom-0 border-t border-border/20 bg-card-bg px-5 py-3">
          <div className="flex items-center gap-2 typo-label text-foreground/80 mb-2">
            Selected
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
                  className="text-foreground/60 hover:text-foreground -mr-0.5"
                  aria-label={`Remove ${c.label}`}
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
