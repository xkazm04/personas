/** TraitPalette — the clickable character vocabulary, grouped by the five axes
 *  the corpus actually speaks (Rigor / Autonomy / Communication / Reliability /
 *  Temperament). Multi-select; the dominant DNA traits float to the top of each
 *  axis by corpus frequency. This is what lets two personas share a model yet
 *  deliberate differently — the traits, not the dials, carry the character.
 */
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { TRAIT_AXES, TRAIT_CATALOG } from "./coreTraits";
import type { PersonaCore } from "./usePersonaCore";

export function TraitPalette({ core }: { core: PersonaCore }) {
  const selected = new Set(core.state.traits);
  return (
    <div className="flex flex-col gap-3">
      {TRAIT_AXES.map((axis) => {
        const traits = TRAIT_CATALOG.filter((t) => t.axis === axis.id).sort((a, b) => b.count - a.count);
        return (
          <div key={axis.id} className="flex flex-col gap-1.5">
            <span className="typo-label uppercase tracking-wider" style={{ color: axis.color }}>{axis.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {traits.map((t) => {
                const active = selected.has(t.id);
                return (
                  <Tooltip key={t.id} content={t.blurb}>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      onClick={() => core.toggleTrait(t.id)}
                      data-testid={`core-trait-${t.id}`}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border typo-caption transition-colors cursor-pointer ${active ? "text-foreground" : "text-foreground/80 border-card-border hover:border-foreground/30"}`}
                      style={active ? { borderColor: colorWithAlpha(axis.color, 0.55), background: colorWithAlpha(axis.color, 0.14) } : undefined}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: active ? axis.color : "rgba(255,255,255,0.08)" }}
                      >
                        {active && <Check className="w-2.5 h-2.5 text-background" />}
                      </span>
                      {t.label}
                    </motion.button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
