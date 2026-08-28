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
import { useTranslation } from "@/i18n/useTranslation";
import { ACCENT, coreIcon } from "./catalog";
import type { PersonaCore } from "./types";

const EASE = [0.16, 1, 0.3, 1] as const;

export function PersonaCoreBadge({ core, onOpen, locked = false, index = 0 }: { core: PersonaCore; onOpen: () => void; locked?: boolean; index?: number }) {
  const { t } = useTranslation();
  const { configured, preset } = core;
  const PresetIcon = preset ? coreIcon(preset.icon) : Atom;
  const accent = preset?.color ?? ACCENT;
  // `preset.name` is the archetype's own name, which comes from the catalog the
  // backend serves and is deliberately NOT translated here.
  const label = configured ? (preset ? preset.name : t.agents.core_custom) : t.agents.core_title;

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
      // The UNCONFIGURED skin is carried by semantic classes, not an inline
      // literal-white fill. An inline style wins the cascade outright, so the
      // app's [data-theme^="light"] overrides could never reach it and the chip
      // painted white-on-white in every light theme — with nothing to catch it,
      // since the lint colour rules only inspect Tailwind class names.
      // Only the CONFIGURED skin stays inline: it is tinted from the
      // archetype's own runtime colour, which no class can express.
      className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-interactive border transition-colors ${locked ? "cursor-default" : "cursor-pointer hover:border-foreground/30"} ${configured ? "" : "border-card-border bg-secondary/20"}`}
      style={configured ? {
        borderColor: colorWithAlpha(accent, 0.5),
        background: colorWithAlpha(accent, 0.14),
      } : undefined}
    >
      <span
        className={`w-5 h-5 rounded-input flex items-center justify-center shrink-0 ${configured ? "" : "bg-secondary/50"}`}
        style={configured ? { background: colorWithAlpha(accent, 0.22) } : undefined}
      >
        <PresetIcon className="w-3.5 h-3.5" style={{ color: configured ? accent : undefined }} />
      </span>
      <span className="typo-caption text-foreground">{label}</span>
    </motion.button>
  );
}
