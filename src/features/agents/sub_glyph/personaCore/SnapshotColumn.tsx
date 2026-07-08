/** SnapshotColumn — the mentality presets as a vertical medallion list (the right
 *  column). Icon-forward: one glyph + name per row, so the column scans without
 *  reading. Picking one seeds disposition + conflict + dominant traits (applyPreset). */
import { motion } from "framer-motion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { coreIcon } from "./catalog";
import type { PersonaCore } from "./types";

export function SnapshotColumn({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col gap-1.5">
      {core.archetypes.map((a) => {
        const Icon = coreIcon(a.icon);
        const on = core.state.archetypeId === a.id;
        return (
          <motion.button
            key={a.id} type="button" whileTap={{ scale: 0.97 }}
            onClick={() => core.applyPreset(a)}
            data-testid={`core-snapshot-${a.id}`}
            aria-pressed={on}
            className={`relative flex items-center gap-2.5 px-2.5 py-2 rounded-interactive text-left transition-colors cursor-pointer ${on ? "" : "hover:bg-secondary/40"}`}
          >
            {on && <span className="absolute inset-0 rounded-interactive" style={{ background: colorWithAlpha(a.color, 0.14), boxShadow: `inset 0 0 0 1px ${colorWithAlpha(a.color, 0.45)}` }} />}
            <span className="relative z-10 w-7 h-7 rounded-input flex items-center justify-center shrink-0" style={{ background: on ? colorWithAlpha(a.color, 0.24) : "rgba(255,255,255,0.05)" }}>
              <Icon className="w-4 h-4" style={{ color: a.color }} />
            </span>
            <span className="relative z-10 typo-body text-foreground truncate">{a.name}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
