/** CoreCharacter — the rethought persona-core configurator.
 *
 *  Left = WHO IT IS: a single disposition slider (risk + speed collapsed — they
 *  were near-collinear in the corpus), a conflict-style temperament, and the
 *  clickable trait palette that carries most of the character. Right = WHAT RUNS
 *  IT & WHAT IT KEEPS: model tier × reasoning effort, and the orthogonal memory
 *  choices. Archetype snapshots up top seed disposition + conflict style.
 */
import { motion, AnimatePresence } from "framer-motion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { coreIcon, PolaritySlider, Segment, ACCENT } from "./coreBits";
import { TraitPalette } from "./TraitPalette";
import { MemorySection } from "./MemorySection";
import { CONFLICT_STYLES } from "./coreTraits";
import { MODEL_TIERS, EFFORT_TIERS, type PersonaCore } from "./usePersonaCore";

export function CoreCharacter({ core }: { core: PersonaCore }) {
  const { state } = core;
  return (
    <div className="flex flex-col gap-4 max-h-[62vh] overflow-y-auto scrollbar-thin pr-1">
      {/* snapshot presets */}
      <div className="flex flex-col gap-1.5">
        <span className="typo-label uppercase tracking-wider text-foreground">Start from a mentality</span>
        <div className="flex flex-wrap gap-1.5">
          {core.archetypes.map((a) => {
            const Icon = coreIcon(a.icon);
            const active = state.archetypeId === a.id;
            return (
              <motion.button
                key={a.id} type="button" whileTap={{ scale: 0.95 }}
                onClick={() => core.applyPreset(a)}
                data-testid={`core-snapshot-${a.id}`}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border typo-caption transition-colors cursor-pointer ${active ? "text-foreground" : "text-foreground/80 border-card-border hover:border-foreground/30"}`}
                style={active ? { borderColor: colorWithAlpha(a.color, 0.55), background: colorWithAlpha(a.color, 0.12) } : undefined}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: a.color }} />
                {a.name}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* WHO IT IS */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="relative rounded-card border border-card-border bg-secondary/20 p-3 overflow-hidden">
            <AnimatePresence>
              {core.preset && (
                <motion.div
                  key={state.archetypeId}
                  initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: colorWithAlpha(core.preset.color, 0.16) }}
                />
              )}
            </AnimatePresence>
            <PolaritySlider label="Disposition" lowLabel="Cautious" highLabel="Bold" value={state.disposition} color="#fb7185" onChange={core.setDisposition} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="typo-label uppercase tracking-wider text-foreground">In disagreement</span>
            <div className="flex flex-wrap gap-1.5">
              {CONFLICT_STYLES.map((c) => {
                const active = state.conflictStyle === c.id;
                return (
                  <button
                    key={c.id} type="button"
                    onClick={() => core.setConflict(c.id)}
                    title={c.blurb}
                    data-testid={`core-conflict-${c.id}`}
                    aria-pressed={active}
                    className={`px-2.5 py-1 rounded-full border typo-caption transition-colors cursor-pointer ${active ? "text-foreground border-transparent" : "text-foreground/80 border-card-border hover:border-foreground/30"}`}
                    style={active ? { background: colorWithAlpha("#fbbf24", 0.18), boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.5)" } : undefined}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="inline-flex items-center justify-between">
              <span className="typo-label uppercase tracking-wider text-foreground">Character traits</span>
              {state.traits.length > 0 && <span className="typo-caption" style={{ color: ACCENT }}>{state.traits.length} chosen</span>}
            </span>
            <TraitPalette core={core} />
          </div>
        </div>

        {/* WHAT RUNS IT & WHAT IT KEEPS */}
        <div className="w-full lg:w-[300px] shrink-0 flex flex-col gap-4 lg:pl-6 lg:border-l border-card-border/50">
          <Segment label="Model" layoutGroup="model" color={ACCENT} value={state.model} onChange={core.setModel} options={MODEL_TIERS} />
          <Segment label="Reasoning effort" layoutGroup="effort" color="#a78bfa" value={state.effort} onChange={core.setEffort} options={EFFORT_TIERS} />
          <div className="flex flex-col gap-2">
            <span className="typo-label uppercase tracking-wider text-foreground">Memory</span>
            <MemorySection core={core} />
          </div>
        </div>
      </div>
    </div>
  );
}
