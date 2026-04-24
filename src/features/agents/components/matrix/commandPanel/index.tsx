/**
 * CommandPanel — pre-build composition for the Glyph Full surface.
 *
 * Wraps the active variant with a tiny tab strip so we can A/B between
 * different compositions of `textarea + DimensionQuickConfig` without
 * touching the call site in GlyphFullLayout. Variant preference persists
 * in localStorage under `personas:command-panel-variant`.
 *
 * Current variants:
 *   · baseline — "Workbench": horizontal 2-col card (shipped design)
 *   · composer — "Message composer": vertical hero textarea + attachments
 */
import { useState, useCallback } from "react";
import { CommandPanelBaseline } from "./CommandPanelBaseline";
import { CommandPanelComposer } from "./CommandPanelComposer";
import type { CommandPanelProps, CommandPanelVariant } from "./types";

const VARIANT_STORAGE_KEY = "personas:command-panel-variant";

function readVariantPreference(): CommandPanelVariant {
  try {
    const raw = localStorage.getItem(VARIANT_STORAGE_KEY);
    if (raw === "baseline" || raw === "composer") return raw;
  } catch { /* SSR or disabled localStorage */ }
  return "baseline";
}
function writeVariantPreference(v: CommandPanelVariant): void {
  try { localStorage.setItem(VARIANT_STORAGE_KEY, v); } catch { /* best-effort */ }
}

interface TabDef {
  id: CommandPanelVariant;
  label: string;
  subtitle: string;
}
const TABS: TabDef[] = [
  { id: "baseline", label: "Workbench", subtitle: "Side-by-side form" },
  { id: "composer", label: "Composer", subtitle: "Hero textarea + attachments" },
];

export function CommandPanel(props: CommandPanelProps) {
  const [variant, setVariant] = useState<CommandPanelVariant>(readVariantPreference);
  const handleChange = useCallback((next: CommandPanelVariant) => {
    setVariant(next);
    writeVariantPreference(next);
  }, []);

  const ActiveVariant =
    variant === "composer" ? CommandPanelComposer : CommandPanelBaseline;

  return (
    <div className="w-full max-w-5xl flex flex-col items-center gap-2">
      {/* Variant switcher — unobtrusive strip above the active panel. */}
      <div
        className="self-end inline-flex rounded-full border border-border/30 bg-secondary/20 p-0.5"
        data-testid="command-panel-variant-toggle"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleChange(tab.id)}
            title={tab.subtitle}
            data-testid={`command-panel-variant-${tab.id}`}
            className={`rounded-full px-3 py-1 typo-caption transition ${
              variant === tab.id
                ? "bg-primary/20 text-primary"
                : "text-foreground/60 hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="w-full flex justify-center">
        <ActiveVariant {...props} />
      </div>
    </div>
  );
}

export type { CommandPanelProps } from "./types";
