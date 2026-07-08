/** CoreSheet — the "character sheet" layout. All configuration stacks in a single
 *  readable column on the left; a persistent panel on the right reads the persona
 *  back in plain language as it forms, so you always see WHO you're building — the
 *  disposition word, the traits by axis, the engine, and what it remembers. The
 *  metaphor is an RPG character sheet: you tune stats on the left, the sheet on the
 *  right narrates the character.
 */
import { motion } from "framer-motion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { SectionHeader, SnapshotRow, DispositionBlock, EngineBlock, dispositionWord, effortWord, titleCase } from "./coreSections";
import { TraitPalette } from "./TraitPalette";
import { MemorySection } from "./MemorySection";
import { coreIcon, ACCENT } from "./coreBits";
import { TRAIT_AXES, traitById, CONFLICT_STYLES } from "./coreTraits";
import type { PersonaCore } from "./usePersonaCore";

export function CoreSheet({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col lg:flex-row gap-6 max-h-[64vh]">
      {/* config column */}
      <div className="flex-1 min-w-0 flex flex-col gap-5 overflow-y-auto scrollbar-thin pr-2">
        <SnapshotRow core={core} />
        <div className="flex flex-col gap-3"><SectionHeader>Disposition &amp; temperament</SectionHeader><DispositionBlock core={core} /></div>
        <div className="flex flex-col gap-3"><SectionHeader>Engine</SectionHeader><EngineBlock core={core} /></div>
        <div className="flex flex-col gap-3"><SectionHeader>Character</SectionHeader><TraitPalette core={core} /></div>
        <div className="flex flex-col gap-3"><SectionHeader>Memory</SectionHeader><MemorySection core={core} /></div>
      </div>
      {/* live character sheet */}
      <div className="w-full lg:w-[280px] shrink-0">
        <div className="lg:sticky lg:top-0"><CharacterSheet core={core} /></div>
      </div>
    </div>
  );
}

function CharacterSheet({ core }: { core: PersonaCore }) {
  const { state, preset } = core;
  const Icon = preset ? coreIcon(preset.icon) : null;
  const accent = preset?.color ?? ACCENT;
  const conflict = CONFLICT_STYLES.find((c) => c.id === state.conflictStyle);
  const chosen = state.traits.map(traitById).filter(Boolean);
  const mem = state.memory;
  const memPills = [
    mem.remembers ? "Remembers" : "Stateless",
    mem.reflect && "Reflects",
    mem.team && "Team ledger",
    mem.obsidian !== "off" && `Obsidian: ${mem.obsidian}`,
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-card border border-card-border bg-secondary/25 p-4 flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-input flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(accent, 0.18) }}>
          {Icon ? <Icon className="w-5 h-5" style={{ color: accent }} /> : <span className="typo-heading" style={{ color: accent }}>◆</span>}
        </span>
        <div className="flex flex-col min-w-0">
          <span className="typo-title-lg leading-tight">{preset ? preset.name : "Custom core"}</span>
          <span className="typo-caption">{dispositionWord(state.disposition)} · {conflict ? conflict.label : "no conflict style"}</span>
        </div>
      </div>

      <SheetRow label="Engine" value={`${titleCase(state.model)} · ${effortWord(state.effort)} effort`} />

      <div className="flex flex-col gap-1.5">
        <span className="typo-label uppercase tracking-[0.15em] text-foreground/85">Traits</span>
        {chosen.length === 0 ? (
          <span className="typo-caption">None yet — pick from the palette.</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {TRAIT_AXES.map((axis) => chosen.filter((t) => t!.axis === axis.id).map((t) => (
              <motion.span key={t!.id} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                className="px-1.5 py-0.5 rounded-full typo-caption text-foreground"
                style={{ background: colorWithAlpha(axis.color, 0.16), boxShadow: `inset 0 0 0 1px ${colorWithAlpha(axis.color, 0.4)}` }}>
                {t!.label}
              </motion.span>
            )))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="typo-label uppercase tracking-[0.15em] text-foreground/85">Memory</span>
        <div className="flex flex-wrap gap-1">
          {memPills.map((p) => (
            <span key={p} className="px-1.5 py-0.5 rounded-full typo-caption text-foreground" style={{ background: colorWithAlpha("#c084fc", 0.16), boxShadow: "inset 0 0 0 1px rgba(192,132,252,0.4)" }}>{p}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SheetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="typo-label uppercase tracking-[0.15em] text-foreground/85">{label}</span>
      <span className="typo-body text-foreground text-right">{value}</span>
    </div>
  );
}
