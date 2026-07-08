/** TraitGrid — the icon-forward trait selector. Each axis is a band (axis icon +
 *  short name) with its traits as aligned icon+label cells, ordered by corpus
 *  frequency. Symbol + order, far less prose than wrapped text chips. */
import { motion } from "framer-motion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { TRAIT_AXES, TRAIT_CATALOG } from "./coreTraits";
import type { PersonaCore } from "./usePersonaCore";

const byAxis = (id: string) => TRAIT_CATALOG.filter((t) => t.axis === id).sort((a, b) => b.count - a.count);

export function AxisTraitGrid({ core }: { core: PersonaCore }) {
  const sel = new Set(core.state.traits);
  return (
    <div className="flex flex-col gap-3">
      {TRAIT_AXES.map((axis) => {
        const AxisIcon = axis.icon;
        return (
          <div key={axis.id} className="flex flex-col gap-1.5">
            <span className="inline-flex items-center gap-1.5 typo-label uppercase tracking-[0.15em]" style={{ color: axis.color }}>
              <AxisIcon className="w-3.5 h-3.5" /> {axis.short}
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {byAxis(axis.id).map((t) => {
                const on = sel.has(t.id);
                const TIcon = t.icon;
                return (
                  <Tooltip key={t.id} content={t.blurb}>
                    <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => core.toggleTrait(t.id)}
                      data-testid={`core-trait-${t.id}`} aria-pressed={on}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-input border transition-colors cursor-pointer ${on ? "text-foreground" : "text-foreground/85 border-card-border hover:border-foreground/30"}`}
                      style={on ? { borderColor: colorWithAlpha(axis.color, 0.55), background: colorWithAlpha(axis.color, 0.14) } : undefined}>
                      <TIcon className="w-3.5 h-3.5 shrink-0" style={{ color: on ? axis.color : undefined }} />
                      <span className="typo-body text-foreground truncate">{t.label}</span>
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
