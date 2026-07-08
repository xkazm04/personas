/** TraitGrid — icon-forward trait selectors for the visual variants.
 *
 *  AxisTraitGrid: an ORDERED grid — each axis is a band (color rail + axis icon +
 *  short name) with its traits as aligned icon+label cells. Symbol + order, far
 *  less prose than the wrapped text chips of the baseline.
 *  TraitNodes: icon-ONLY nodes grouped by axis (label + blurb on hover) — the slim
 *  selector for the Wheel variant, where the sigil is the star.
 */
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
                      <span className="typo-caption text-foreground truncate">{t.label}</span>
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

export function TraitNodes({ core }: { core: PersonaCore }) {
  const sel = new Set(core.state.traits);
  return (
    <div className="flex flex-col gap-2.5">
      {TRAIT_AXES.map((axis) => {
        const AxisIcon = axis.icon;
        return (
          <div key={axis.id} className="flex items-center gap-2">
            <Tooltip content={axis.label}>
              <span className="w-6 h-6 rounded-input flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(axis.color, 0.16) }}>
                <AxisIcon className="w-3.5 h-3.5" style={{ color: axis.color }} />
              </span>
            </Tooltip>
            <div className="flex flex-wrap gap-1">
              {byAxis(axis.id).map((t) => {
                const on = sel.has(t.id);
                const TIcon = t.icon;
                return (
                  <Tooltip key={t.id} content={`${t.label} — ${t.blurb}`}>
                    <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => core.toggleTrait(t.id)}
                      data-testid={`core-trait-${t.id}`} aria-pressed={on}
                      className={`w-7 h-7 rounded-full flex items-center justify-center border transition-colors cursor-pointer ${on ? "" : "border-card-border hover:border-foreground/30"}`}
                      style={on ? { borderColor: colorWithAlpha(axis.color, 0.6), background: colorWithAlpha(axis.color, 0.2) } : undefined}>
                      <TIcon className="w-3.5 h-3.5" style={{ color: on ? axis.color : "rgba(255,255,255,0.55)" }} />
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
