/** PersonaCoreModal — the persona-core configurator, with a directional-variant
 *  switcher on top (prototype scaffold). Three approaches to combining archetype
 *  PRESETS with manual Risk/Speed/Model/Memory tuning:
 *    • Atelier — preset-first gallery, refine below
 *    • Console — manual-first mixer, presets as snapshot chips
 *    • Compass — spatial risk×speed pad with archetypes plotted
 *  The switcher is throwaway; once a direction wins it collapses to that one.
 */
import { useState } from "react";
import { SlidersHorizontal, LayoutGrid, Compass, RotateCcw } from "lucide-react";
import { BaseModal } from "@/features/shared/components/modals";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import Button from "@/features/shared/components/buttons/Button";
import type { PersonaCore } from "./usePersonaCore";
import { CoreAtelier } from "./CoreAtelier";
import { CoreConsole } from "./CoreConsole";
import { CoreCompass } from "./CoreCompass";

type Variant = "atelier" | "console" | "compass";
const VARIANTS: { id: Variant; label: string; icon: typeof Compass; sub: string }[] = [
  { id: "atelier", label: "Atelier", icon: LayoutGrid, sub: "Preset-first gallery" },
  { id: "console", label: "Console", icon: SlidersHorizontal, sub: "Manual mixer" },
  { id: "compass", label: "Compass", icon: Compass, sub: "Spatial pad" },
];

export function PersonaCoreModal({ core, isOpen, onClose }: { core: PersonaCore; isOpen: boolean; onClose: () => void }) {
  const [variant, setVariant] = useState<Variant>("atelier");

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="persona-core-modal" size="xl">
      <div className="flex flex-col gap-4 p-5" data-testid="persona-core-modal">
        {/* header + variant switcher */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <h2 id="persona-core-modal" className="typo-title-lg text-foreground">Persona core</h2>
            <span className="typo-caption">The temperament under the task — pick a mentality, then tune Risk, Speed, Model & Memory.</span>
          </div>
          <div className="flex gap-1 p-1 rounded-interactive bg-secondary/50" role="tablist" aria-label="Configurator design">
            {VARIANTS.map((v) => {
              const Icon = v.icon;
              const active = v.id === variant;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setVariant(v.id)}
                  data-testid={`core-variant-${v.id}`}
                  className={`inline-flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-input transition-colors cursor-pointer ${active ? "bg-primary/15 text-primary" : "text-foreground/70 hover:text-foreground"}`}
                >
                  <span className="inline-flex items-center gap-1.5 typo-caption font-medium"><Icon className="w-3.5 h-3.5" />{v.label}</span>
                  <span className="typo-caption text-[10px] opacity-80">{v.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* body */}
        {core.loading ? (
          <div className="py-16 flex justify-center"><LoadingSpinner label="Loading mentalities…" /></div>
        ) : (
          <div className="pt-1">
            {variant === "atelier" && <CoreAtelier core={core} />}
            {variant === "console" && <CoreConsole core={core} />}
            {variant === "compass" && <CoreCompass core={core} />}
          </div>
        )}

        {/* footer */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-card-border/50">
          <button
            type="button"
            onClick={core.reset}
            disabled={!core.configured}
            className="inline-flex items-center gap-1.5 typo-caption text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:text-foreground/80"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
          </button>
          <Button variant="primary" size="sm" onClick={onClose} data-testid="persona-core-done">Done</Button>
        </div>
      </div>
    </BaseModal>
  );
}
