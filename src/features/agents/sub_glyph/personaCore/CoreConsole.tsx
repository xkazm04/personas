/** CoreConsole — manual-first variant.
 *
 *  Mental model: a mixing console. The four knobs are the hero, sized for
 *  deliberate tuning; archetype presets sit on top as one-click "load a
 *  snapshot" chips. Manual drives, presets are shortcuts. A live plain-language
 *  read of the current settings sits at the bottom so the abstract numbers stay
 *  legible.
 */
import { motion, AnimatePresence } from "framer-motion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { coreIcon, PolaritySlider, ModelSegment, MemoryPicker, ACCENT } from "./coreBits";
import { MODEL_TIERS, type PersonaCore } from "./usePersonaCore";

export function CoreConsole({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col gap-4 max-h-[58vh] overflow-y-auto scrollbar-thin pr-1">
      {/* Snapshot chips */}
      <div className="flex flex-col gap-1.5">
        <span className="typo-label uppercase tracking-wider text-foreground">Load a snapshot</span>
        <div className="flex flex-wrap gap-1.5">
          {core.archetypes.map((a) => {
            const Icon = coreIcon(a.icon);
            const active = core.state.archetypeId === a.id;
            return (
              <motion.button
                key={a.id}
                type="button"
                onClick={() => core.applyPreset(a)}
                whileTap={{ scale: 0.95 }}
                data-testid={`core-snapshot-${a.id}`}
                className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border typo-caption transition-colors cursor-pointer ${active ? "text-foreground" : "text-foreground/80 border-card-border hover:border-foreground/30"}`}
                style={active ? { borderColor: colorWithAlpha(a.color, 0.55), background: colorWithAlpha(a.color, 0.12) } : undefined}
                aria-pressed={active}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: a.color }} />
                {a.name}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Knob console — a snapshot load flashes the panel in the preset's colour
          while the risk/speed sliders spring to their new positions. */}
      <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 p-4 rounded-card border border-card-border bg-secondary/20 overflow-hidden">
        <AnimatePresence>
          {core.preset && (
            <motion.div
              key={core.state.archetypeId}
              initial={{ opacity: 0.5 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="absolute inset-0 pointer-events-none"
              style={{ background: colorWithAlpha(core.preset.color, 0.16) }}
            />
          )}
        </AnimatePresence>
        <PolaritySlider label="Risk" lowLabel="Cautious" highLabel="Bold" value={core.state.risk} color="#fb7185" onChange={core.setRisk} />
        <PolaritySlider label="Speed" lowLabel="Thorough" highLabel="Fast" value={core.state.speed} color="#fbbf24" onChange={core.setSpeed} />
        <ModelSegment value={core.state.model} color={ACCENT} onChange={core.setModel} />
        <MemoryPicker strategies={core.memoryStrategies} value={core.state.memoryId} color="#c084fc" onChange={core.setMemory} />
      </div>

      {/* Plain-language read */}
      <p className="typo-body text-foreground px-1">{readSentence(core)}</p>
    </div>
  );
}

function readSentence(core: PersonaCore): string {
  const risk = core.state.risk < 0.34 ? "plays it safe" : core.state.risk > 0.66 ? "acts boldly" : "takes measured risks";
  const speed = core.state.speed < 0.34 ? "prioritises thoroughness" : core.state.speed > 0.66 ? "moves fast" : "balances speed and care";
  const model = MODEL_TIERS.find((m) => m.id === core.state.model)?.label ?? "Balanced";
  const mem = core.memory ? `remembers via ${core.memory.name}` : "keeps no long-term memory";
  return `This agent ${risk}, ${speed}, runs on ${model}, and ${mem}.`;
}
