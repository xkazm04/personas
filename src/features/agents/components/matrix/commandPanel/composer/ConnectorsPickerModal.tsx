/**
 * Connectors picker modal — opens from the Composer's "Tools" row.
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
import { motion, AnimatePresence } from "framer-motion";
import { Search, Plug, Check, Package, SlidersHorizontal } from "lucide-react";
import { useHealthyConnectors, type HealthyConnector } from "@/features/agents/components/matrix/useHealthyConnectors";
import { PickerShell } from "./PickerShell";
import { BrandIcon } from "./BrandIcon";

function humanizeCategory(slug: string): string {
  return slug
    .split(/[_-]/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

interface ConnectorCardProps {
  connector: HealthyConnector;
  selected: boolean;
  onToggle: () => void;
}
function ConnectorCard({ connector, selected, onToggle }: ConnectorCardProps) {
  const meta = connector.meta;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group relative flex items-center gap-3 p-3 rounded-card border transition-all text-left ${
        selected
          ? "border-primary/60 bg-primary/10"
          : "border-border/25 bg-foreground/[0.02] hover:border-primary/35 hover:bg-primary/[0.04]"
      }`}
      style={selected ? { boxShadow: `0 0 18px ${meta.color}33` } : undefined}
    >
      <div
        className="shrink-0 w-10 h-10 rounded-interactive flex items-center justify-center overflow-hidden"
        style={{ background: `${meta.color}26` }}
      >
        {meta.iconUrl ? (
          <BrandIcon iconUrl={meta.iconUrl} color={meta.color} size={22} />
        ) : (
          <Plug className="w-5 h-5" style={{ color: meta.color }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="typo-body text-foreground font-medium truncate">{meta.label}</div>
        <div className="typo-caption text-foreground/70 truncate">
          {humanizeCategory(connector.category)}
        </div>
      </div>
      {selected && (
        <span
          className="shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
          style={{ boxShadow: "0 0 10px rgba(96,165,250,0.8)" }}
        >
          <Check className="w-3 h-3 text-white" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

interface ConnectorsPickerModalProps {
  open: boolean;
  onClose: () => void;
  selected: string[];
  onApply: (next: string[]) => void;
}

export function ConnectorsPickerModal({ open, onClose, selected, onApply }: ConnectorsPickerModalProps) {
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
      // Autofocus search on next tick so the modal has finished entering.
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
    <PickerShell
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
      {/* Search + filter bar — solid background so scrolling content
          can't bleed through. Filter chips hidden by default; user clicks
          the Filter icon to reveal them. */}
      <div className="sticky top-0 z-10 bg-card-bg border-b border-border/20 px-5 py-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/50" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps…"
              className="w-full pl-9 pr-3 py-2 rounded-interactive bg-foreground/5 border border-border/30 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
            />
          </div>
          {categories.length > 1 && (
            <button
              type="button"
              onClick={() => setFiltersOpen((p) => !p)}
              aria-pressed={filtersOpen}
              title={filtersOpen ? "Hide filters" : "Show filters"}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-interactive border transition-colors ${
                filtersOpen || category !== "__all__"
                  ? "bg-primary/20 border-primary/50 text-foreground"
                  : "bg-foreground/5 border-border/30 text-foreground/85 hover:border-primary/30 hover:text-foreground"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="typo-caption font-medium">
                {category === "__all__" ? "Filter" : humanizeCategory(category)}
              </span>
            </button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {filtersOpen && categories.length > 1 && (
            <motion.div
              key="filters"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <button
                  type="button"
                  onClick={() => setCategory("__all__")}
                  className={`px-2.5 py-1 rounded-full typo-caption transition-colors ${
                    category === "__all__"
                      ? "bg-primary/25 text-foreground border border-primary/50 font-medium"
                      : "bg-foreground/5 text-foreground/80 border border-border/30 hover:border-primary/30"
                  }`}
                >
                  All · {healthy.length}
                </button>
                {categories.map(({ cat, n }) => {
                  const active = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={`px-2.5 py-1 rounded-full typo-caption transition-colors ${
                        active
                          ? "bg-primary/25 text-foreground border border-primary/50 font-medium"
                          : "bg-foreground/5 text-foreground/80 border border-border/30 hover:border-primary/30"
                      }`}
                    >
                      {humanizeCategory(cat)} · {n}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Grid or empty state */}
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
              <ConnectorCard
                key={c.name}
                connector={c}
                selected={draft.includes(c.name)}
                onToggle={() => toggleDraft(c.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selected tray — sticky above footer */}
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
    </PickerShell>
  );
}
