/** ConfigTiles — icon-forward, low-text configuration controls. Conflict / model
 *  are icon TILES, effort is an ascending stepped METER — symbols and alignment
 *  instead of segmented rows of words. (Disposition uses PolaritySlider.) */
import { Feather, Sparkles, Brain, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { ACCENT, CONFLICT_STYLES, EFFORT_TIERS, MODEL_TIERS } from "./catalog";
import type { EffortLevel, ModelTier, PersonaCore } from "./types";

const MODEL_ICON: Record<ModelTier, LucideIcon> = { haiku: Feather, sonnet: Sparkles, opus: Brain };

/** A single icon tile — the shared atom for the tile groups. */
function IconTile({ icon: Icon, label, active, color, onClick, testid, blurb }: {
  icon: LucideIcon; label: string; active: boolean; color: string; onClick: () => void; testid?: string; blurb?: string;
}) {
  const tile = (
    <motion.button
      type="button" whileTap={{ scale: 0.96 }} onClick={onClick} data-testid={testid} aria-pressed={active}
      className={`flex-1 min-w-0 flex flex-col items-center gap-1 px-2 py-2 rounded-input border transition-colors cursor-pointer ${active ? "text-foreground" : "text-foreground/85 border-card-border hover:border-foreground/30"}`}
      style={active ? { borderColor: colorWithAlpha(color, 0.6), background: colorWithAlpha(color, 0.14) } : undefined}
    >
      <Icon className="w-4 h-4" style={{ color: active ? color : undefined }} />
      <span className="typo-body text-foreground leading-none">{label}</span>
    </motion.button>
  );
  return blurb ? <Tooltip content={blurb}>{tile}</Tooltip> : tile;
}

export function ConflictTiles({ core }: { core: PersonaCore }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {CONFLICT_STYLES.map((c) => (
        <IconTile key={c.id} icon={c.icon} label={c.label} blurb={c.blurb} color="#fbbf24"
          active={core.state.conflictStyle === c.id} onClick={() => core.setConflict(c.id)} testid={`core-conflict-${c.id}`} />
      ))}
    </div>
  );
}

export function ModelTiles({ core }: { core: PersonaCore }) {
  return (
    <div className="flex gap-1.5">
      {MODEL_TIERS.map((m) => (
        <IconTile key={m.id} icon={MODEL_ICON[m.id]} label={m.label} blurb={m.blurb} color={ACCENT}
          active={core.state.model === m.id} onClick={() => core.setModel(m.id)} testid={`core-model-${m.id}`} />
      ))}
    </div>
  );
}

/** Effort as an ascending 4-step meter — the bars grow with reasoning depth. */
export function EffortMeter({ core }: { core: PersonaCore }) {
  const idx = EFFORT_TIERS.findIndex((e) => e.id === core.state.effort);
  const purple = "#a78bfa";
  return (
    <div className="flex items-end gap-1.5">
      {EFFORT_TIERS.map((e, i) => {
        const on = i <= idx;
        const h = 12 + i * 6; // ascending
        return (
          <Tooltip key={e.id} content={e.blurb}>
            <button type="button" onClick={() => core.setEffort(e.id as EffortLevel)} data-testid={`core-effort-${e.id}`} aria-pressed={core.state.effort === e.id}
              className="flex-1 flex flex-col items-center gap-1 cursor-pointer group">
              <span className="w-full rounded-sm transition-colors" style={{ height: h, background: on ? colorWithAlpha(purple, core.state.effort === e.id ? 0.9 : 0.5) : "rgba(255,255,255,0.08)" }} />
              <span className={`typo-body leading-none ${core.state.effort === e.id ? "text-foreground" : "text-foreground/85 group-hover:text-foreground"}`}>{e.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
