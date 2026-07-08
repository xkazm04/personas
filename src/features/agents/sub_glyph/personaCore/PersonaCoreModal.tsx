/** PersonaCoreModal — the persona-core configurator, in /prototype mode.
 *
 *  Rethought (2026-07-08) against the real corpus: model tier × reasoning effort,
 *  a disposition slider + conflict style + a clickable character-trait palette.
 *  Memory is NOT here — the build surface's memory dimension owns it. All three
 *  variants share the 3-column skeleton (Character · Configuration · Mentality):
 *   • Workbench (baseline) — text-forward reference; wrapped chips + segments.
 *   • Codex — ordered icon GRID: traits/conflict/model as aligned symbols, effort meter.
 *   • Wheel — a radial character SIGIL is the star; icon-node traits light it up.
 *  The switcher is throwaway scaffolding; it goes away once a direction wins.
 */
import { useState } from "react";
import { BaseModal } from "@/features/shared/components/modals";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import Button from "@/features/shared/components/buttons/Button";
import { RotateCcw } from "lucide-react";
import type { PersonaCore } from "./usePersonaCore";
import { CoreWorkbench } from "./CoreWorkbench";
import { CoreCodex } from "./CoreCodex";
import { CoreWheel } from "./CoreWheel";

type VariantId = "workbench" | "codex" | "wheel";
const VARIANTS: { id: VariantId; label: string; sub: string }[] = [
  { id: "workbench", label: "Workbench", sub: "text-forward baseline" },
  { id: "codex", label: "Codex", sub: "ordered icon grid" },
  { id: "wheel", label: "Wheel", sub: "radial character sigil" },
];

export function PersonaCoreModal({ core, isOpen, onClose }: { core: PersonaCore; isOpen: boolean; onClose: () => void }) {
  const [variant, setVariant] = useState<VariantId>("workbench");
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="persona-core-modal" size="6xl">
      <div className="flex flex-col gap-4 p-5" data-testid="persona-core-modal">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 id="persona-core-modal" className="typo-title-lg text-foreground">Persona core</h2>
            <span className="typo-caption">Who this agent is under the task — its disposition, character, the model that runs it, and what it remembers.</span>
          </div>
          {/* prototype variant switcher (throwaway) */}
          <div className="flex gap-1 p-1 rounded-interactive bg-secondary/60 shrink-0">
            {VARIANTS.map((v) => {
              const on = v.id === variant;
              return (
                <button key={v.id} type="button" onClick={() => setVariant(v.id)}
                  data-testid={`core-variant-${v.id}`}
                  title={v.sub}
                  className={`px-3 py-1.5 rounded-input typo-body transition-colors cursor-pointer ${on ? "bg-secondary text-foreground shadow-elevation-1" : "text-foreground/85 hover:text-foreground"}`}>
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>

        {core.loading ? (
          <div className="py-16 flex justify-center"><LoadingSpinner label="Loading mentalities…" /></div>
        ) : variant === "workbench" ? (
          <CoreWorkbench core={core} />
        ) : variant === "codex" ? (
          <CoreCodex core={core} />
        ) : (
          <CoreWheel core={core} />
        )}

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
