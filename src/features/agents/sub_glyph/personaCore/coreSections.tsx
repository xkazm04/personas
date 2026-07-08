/** coreSections — the shared building blocks the persona-core layout variants
 *  compose (snapshot row, disposition + conflict, model + effort engine). Keeping
 *  them here means the three prototype layouts differ only in ARRANGEMENT, and the
 *  calibrated typography lives in one place.
 *
 *  Typography tiers (fixing the flat-contrast read):
 *   • Column header  → typo-title-lg      (1rem, tinted)      — dominant
 *   • Field label    → typo-heading        (0.875rem, 700 fg)  — clearly above body
 *   • Interactive    → typo-body text-fg   (0.875rem, 400 fg)  — readable, not muted
 *   • Description    → typo-caption         (0.875rem, 70% fg)  — the only muted tier
 */
import { motion, AnimatePresence } from "framer-motion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { coreIcon, PolaritySlider, Segment, ACCENT } from "./coreBits";
import { CONFLICT_STYLES } from "./coreTraits";
import { MODEL_TIERS, EFFORT_TIERS, type PersonaCore } from "./usePersonaCore";

/** Shared plain-language labels for the readback surfaces (Sheet / Guided rail). */
export const dispositionWord = (v: number) => (v < 0.34 ? "Cautious" : v > 0.66 ? "Bold" : "Balanced");
export const effortWord = (e: string) => (e === "xhigh" ? "Max" : e.charAt(0).toUpperCase() + e.slice(1));
export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Section/column heading — the dominant tier. */
export function SectionHeader({ children }: { children: React.ReactNode }) {
  return <span className="typo-title-lg">{children}</span>;
}

/** Field label — bold foreground, clearly above the muted description tier. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="typo-heading text-foreground">{children}</span>;
}

export function SnapshotRow({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Start from a mentality</FieldLabel>
      <div className="flex flex-wrap gap-1.5">
        {core.archetypes.map((a) => {
          const Icon = coreIcon(a.icon);
          const active = core.state.archetypeId === a.id;
          return (
            <motion.button
              key={a.id} type="button" whileTap={{ scale: 0.95 }}
              onClick={() => core.applyPreset(a)}
              data-testid={`core-snapshot-${a.id}`}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border typo-body transition-colors cursor-pointer ${active ? "text-foreground" : "text-foreground/85 border-card-border hover:border-foreground/30"}`}
              style={active ? { borderColor: colorWithAlpha(a.color, 0.55), background: colorWithAlpha(a.color, 0.12) } : undefined}
            >
              <Icon className="w-3.5 h-3.5" style={{ color: a.color }} />
              {a.name}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/** Disposition slider + conflict style, with the snapshot colour flash. */
export function DispositionBlock({ core }: { core: PersonaCore }) {
  const { state } = core;
  return (
    <div className="flex flex-col gap-4">
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

      <div className="flex flex-col gap-2">
        <FieldLabel>In disagreement</FieldLabel>
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
                className={`px-2.5 py-1 rounded-full border typo-body transition-colors cursor-pointer ${active ? "text-foreground border-transparent" : "text-foreground/85 border-card-border hover:border-foreground/30"}`}
                style={active ? { background: colorWithAlpha("#fbbf24", 0.18), boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.5)" } : undefined}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Model tier × reasoning effort. */
export function EngineBlock({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col gap-4">
      <Segment label="Model" layoutGroup="model" color={ACCENT} value={core.state.model} onChange={core.setModel} options={MODEL_TIERS} />
      <Segment label="Reasoning effort" layoutGroup="effort" color="#a78bfa" value={core.state.effort} onChange={core.setEffort} options={EFFORT_TIERS} />
    </div>
  );
}
