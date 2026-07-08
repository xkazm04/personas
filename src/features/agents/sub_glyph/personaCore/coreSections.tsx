/** coreSections — shared pieces + the typography strategy for the persona-core
 *  configurator (the "Codex" layout).
 *
 *  Typography tiers — the goal is that a column TITLE clearly dominates the
 *  content beneath it, and the field markers read as quiet overlines, not as more
 *  body text:
 *   • Column title  → typo-section-title  (1.125rem, tinted)     — dominant anchor
 *   • Field marker  → typo-label           (0.75rem, uppercase)   — quiet overline
 *   • Content       → typo-body text-fg    (0.875rem, 400 fg)     — the readable tier
 *   • Description   → typo-caption          (0.875rem, 70% fg)     — the only muted tier
 */
import { motion } from "framer-motion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { coreIcon } from "./coreBits";
import type { PersonaCore } from "./usePersonaCore";

/** Column title — the dominant tier that anchors each column. */
export function SectionHeader({ children }: { children: React.ReactNode }) {
  return <span className="typo-section-title">{children}</span>;
}

/** Field marker — a quiet uppercase overline, deliberately below the content. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="typo-label uppercase tracking-[0.15em] text-foreground/85">{children}</span>;
}

/** Vertical mentality medallions — the snapshot presets as a right-column list.
 *  Icon-forward (one glyph + name per row) so the column scans without reading. */
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
