/** CoreGuided — the progressive layout. A left rail walks the five decisions in
 *  order (Mentality → Disposition → Character → Engine → Memory); each rail item
 *  shows a LIVE summary of its current value, so the rail doubles as a running
 *  read of the whole core while the main pane stays focused on one decision at a
 *  time with generous typography. Good when the trait palette feels overwhelming
 *  all-at-once — you meet it one step in.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Wand2, Gauge, Drama, Cpu, Brain } from "lucide-react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { SnapshotRow, DispositionBlock, EngineBlock, dispositionWord, effortWord, titleCase } from "./coreSections";
import { TraitPalette } from "./TraitPalette";
import { MemorySection } from "./MemorySection";
import { ACCENT } from "./coreBits";
import { CONFLICT_STYLES } from "./coreTraits";
import type { PersonaCore } from "./usePersonaCore";

const STEPS = [
  { id: "mentality", label: "Mentality", icon: Wand2, hint: "Start from an archetype — it seeds the rest." },
  { id: "disposition", label: "Disposition", icon: Gauge, hint: "How cautious or bold, and how it handles disagreement." },
  { id: "character", label: "Character", icon: Drama, hint: "The traits that shape how it reasons and communicates." },
  { id: "engine", label: "Engine", icon: Cpu, hint: "Which model runs it, and how hard it thinks." },
  { id: "memory", label: "Memory", icon: Brain, hint: "What it keeps between runs and where it grounds." },
] as const;

function summary(id: string, core: PersonaCore): string {
  const s = core.state;
  switch (id) {
    case "mentality": return core.preset ? core.preset.name : "None chosen";
    case "disposition": { const c = CONFLICT_STYLES.find((x) => x.id === s.conflictStyle); return `${dispositionWord(s.disposition)}${c ? ` · ${c.label}` : ""}`; }
    case "character": return s.traits.length ? `${s.traits.length} trait${s.traits.length > 1 ? "s" : ""}` : "None";
    case "engine": return `${titleCase(s.model)} · ${effortWord(s.effort)}`;
    case "memory": return s.memory.remembers ? "Remembers" : "Stateless";
    default: return "";
  }
}

export function CoreGuided({ core }: { core: PersonaCore }) {
  const [active, setActive] = useState<string>("mentality");
  const step = STEPS.find((s) => s.id === active)!;

  return (
    <div className="flex flex-col lg:flex-row gap-6 max-h-[64vh]">
      {/* rail */}
      <div className="w-full lg:w-[240px] shrink-0 flex flex-col gap-1.5">
        {STEPS.map((s) => {
          const on = s.id === active;
          const Icon = s.icon;
          return (
            <button key={s.id} type="button" onClick={() => setActive(s.id)}
              data-testid={`core-step-${s.id}`}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-interactive text-left transition-colors cursor-pointer ${on ? "" : "hover:bg-secondary/40"}`}>
              {on && <motion.span layoutId="guided-active" className="absolute inset-0 rounded-interactive" style={{ background: colorWithAlpha(ACCENT, 0.14), boxShadow: `inset 0 0 0 1px ${colorWithAlpha(ACCENT, 0.4)}` }} transition={{ type: "spring", stiffness: 320, damping: 30 }} />}
              <span className="relative z-10 w-7 h-7 rounded-input flex items-center justify-center shrink-0" style={{ background: on ? colorWithAlpha(ACCENT, 0.22) : "rgba(255,255,255,0.05)" }}>
                <Icon className="w-4 h-4" style={{ color: on ? ACCENT : undefined }} />
              </span>
              <span className="relative z-10 flex flex-col min-w-0">
                <span className="typo-body text-foreground leading-tight">{s.label}</span>
                <span className="typo-caption truncate">{summary(s.id, core)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* focused pane */}
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin lg:pl-6 lg:border-l border-card-border/50">
        <motion.div key={active} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="typo-title-lg">{step.label}</span>
            <span className="typo-caption">{step.hint}</span>
          </div>
          {active === "mentality" && <SnapshotRow core={core} />}
          {active === "disposition" && <DispositionBlock core={core} />}
          {active === "character" && <TraitPalette core={core} />}
          {active === "engine" && <EngineBlock core={core} />}
          {active === "memory" && <MemorySection core={core} />}
        </motion.div>
      </div>
    </div>
  );
}
