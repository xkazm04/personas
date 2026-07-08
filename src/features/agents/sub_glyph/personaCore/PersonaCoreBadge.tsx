/** PersonaCoreBadge — the persona-core lever in the dimension badge row.
 *
 *  The intent textarea is the mandatory "what"; the persona core is one of the
 *  OPTIONAL dimensions beside it. So this renders as a sibling chip to the other
 *  dimension badges — icon + label, tinted when configured — and opens the
 *  configurator on click. View-only while a build is in flight.
 */
import { motion } from "framer-motion";
import { Atom } from "lucide-react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { coreIcon } from "./coreBits";
import type { PersonaCore } from "./usePersonaCore";

const ACCENT = "#60A5FA";
const EASE = [0.16, 1, 0.3, 1] as const;

export function PersonaCoreBadge({ core, onOpen, locked = false, index = 0 }: { core: PersonaCore; onOpen: () => void; locked?: boolean; index?: number }) {
  const { configured, preset } = core;
  const PresetIcon = preset ? coreIcon(preset.icon) : Atom;
  const accent = preset?.color ?? ACCENT;
  const label = configured ? (preset ? preset.name : "Custom core") : "Persona core";

  return (
    <motion.button
      type="button"
      onClick={locked ? undefined : onOpen}
      disabled={locked}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE, delay: 0.18 + index * 0.03 }}
      data-testid="persona-core-badge"
      aria-pressed={configured}
      className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-interactive border transition-colors ${locked ? "cursor-default" : "cursor-pointer hover:border-foreground/30"}`}
      style={{
        borderColor: configured ? colorWithAlpha(accent, 0.5) : "rgba(255,255,255,0.12)",
        background: configured ? colorWithAlpha(accent, 0.14) : "rgba(255,255,255,0.03)",
      }}
    >
      <span className="w-5 h-5 rounded-input flex items-center justify-center shrink-0" style={{ background: configured ? colorWithAlpha(accent, 0.22) : "rgba(255,255,255,0.05)" }}>
        <PresetIcon className="w-3.5 h-3.5" style={{ color: configured ? accent : undefined }} />
      </span>
      <span className="typo-caption text-foreground">{label}</span>
    </motion.button>
  );
}
