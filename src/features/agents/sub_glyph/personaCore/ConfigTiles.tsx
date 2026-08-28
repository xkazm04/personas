/** ConfigTiles — icon-forward, low-text configuration controls. Conflict / model
 *  are icon TILES, effort is an ascending stepped METER — symbols and alignment
 *  instead of segmented rows of words. (Disposition uses PolaritySlider.)
 *
 *  Two different a11y contracts live here on purpose. Model and effort are
 *  mutually exclusive, so they are radiogroups with roving tabindex: a screen
 *  reader hears one choice with a current value, and arrow keys move within it.
 *  Conflict style is a genuine toggle (clicking the active style clears it via
 *  setConflict's same-id handler), so it keeps aria-pressed. The three used to
 *  be identical in code while being different in kind. */
import { useCallback, useRef } from "react";
import { type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { useTranslation } from "@/i18n/useTranslation";
import { ACCENT, CONFLICT_ACCENT, CONFLICT_STYLES, EFFORT_ACCENT, EFFORT_TIERS, MODEL_TIERS } from "./catalog";
import type { PersonaCore } from "./types";

interface RadioOptionProps {
  role: "radio";
  "aria-checked": boolean;
  tabIndex: number;
  onKeyDown: (e: React.KeyboardEvent) => void;
  ref: (el: HTMLButtonElement | null) => void;
}

/** Roving tabindex for a single-select group.
 *
 *  Model and effort are mutually exclusive choices, so they are radio groups,
 *  not rows of independent toggles: exactly one option is in the tab order and
 *  the arrow keys move the selection within it. (ConflictTiles is genuinely a
 *  toggle — clicking the active style clears it — so it keeps aria-pressed and
 *  is deliberately NOT routed through here.)
 *
 *  Kept local to this file: it exists to stop two groups in one module from
 *  disagreeing, not to become a shared primitive. */
function useRovingRadio<T extends string>(ids: readonly T[], current: T, select: (id: T) => void) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  const move = useCallback(
    (id: T) => {
      select(id);
      refs.current[id]?.focus();
    },
    [select],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, id: T) => {
      const i = ids.indexOf(id);
      const last = ids.length - 1;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          move(ids[i === last ? 0 : i + 1] ?? id);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          move(ids[i === 0 ? last : i - 1] ?? id);
          break;
        case "Home":
          e.preventDefault();
          move(ids[0] ?? id);
          break;
        case "End":
          e.preventDefault();
          move(ids[last] ?? id);
          break;
      }
    },
    [ids, move],
  );

  /** Props for one option. The checked option is the group's single tab stop;
   *  if nothing is checked the first option holds it, so the group is never
   *  unreachable by keyboard. */
  return (id: T) => ({
    role: "radio" as const,
    "aria-checked": current === id,
    tabIndex: current === id || (!ids.includes(current) && id === ids[0]) ? 0 : -1,
    onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, id),
    ref: (el: HTMLButtonElement | null) => { refs.current[id] = el; },
  });
}

/** A single icon tile — the shared atom for the tile groups.
 *  `costLabel` is an optional relative-spend chip (e.g. "×3"); `costAria` is the
 *  sentence a screen reader gets in its place, since a bare multiplication sign
 *  reads as nothing useful. */
function IconTile({ icon: Icon, label, active, color, onClick, testid, blurb, costLabel, costAria, radio }: {
  icon: LucideIcon; label: string; active: boolean; color: string; onClick: () => void; testid?: string; blurb?: string;
  costLabel?: string; costAria?: string;
  /** Radio-group props from useRovingRadio. Omit for a genuine toggle, which
   *  keeps aria-pressed — the two cases announce differently on purpose. */
  radio?: RadioOptionProps;
}) {
  const tile = (
    <motion.button
      type="button" whileTap={{ scale: 0.96 }} onClick={onClick} data-testid={testid}
      {...(radio ?? { "aria-pressed": active })}
      className={`flex-1 min-w-0 flex flex-col items-center gap-1 px-2 py-2 rounded-input border transition-colors cursor-pointer ${active ? "text-foreground" : "text-foreground/85 border-card-border hover:border-foreground/30"}`}
      style={active ? { borderColor: colorWithAlpha(color, 0.6), background: colorWithAlpha(color, 0.14) } : undefined}
    >
      <Icon className="w-4 h-4" style={{ color: active ? color : undefined }} />
      <span className="typo-body text-foreground leading-none">{label}</span>
      {costLabel && (
        <>
          <span aria-hidden className="typo-caption tabular-nums text-foreground/85 leading-none" data-testid={testid ? `${testid}-cost` : undefined}>
            {costLabel}
          </span>
          <span className="sr-only">{costAria}</span>
        </>
      )}
    </motion.button>
  );
  return blurb ? <Tooltip content={blurb}>{tile}</Tooltip> : tile;
}

export function ConflictTiles({ core }: { core: PersonaCore }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {CONFLICT_STYLES.map((c) => (
        <IconTile key={c.id} icon={c.icon} label={c.label} blurb={c.blurb} color={CONFLICT_ACCENT}
          active={core.state.conflictStyle === c.id} onClick={() => core.setConflict(c.id)} testid={`core-conflict-${c.id}`} />
      ))}
    </div>
  );
}

/** Model tiles carry a relative-cost chip: picking a model is the biggest spend
 *  lever on this screen, and the blurbs alone ("Deepest reasoning...") gave the
 *  user nothing to trade capability against. The multiple lives in the catalog
 *  next to the tier it describes — see MODEL_TIERS' provenance note. */
export function ModelTiles({ core }: { core: PersonaCore }) {
  const { t, tx } = useTranslation();
  const ids = MODEL_TIERS.map((m) => m.id);
  const option = useRovingRadio(ids, core.state.model, core.setModel);
  return (
    <div role="radiogroup" aria-label={t.agents.core_model_label} className="flex gap-1.5">
      {MODEL_TIERS.map((m) => (
        <IconTile key={m.id} icon={m.icon} label={m.label} blurb={m.blurb} color={ACCENT}
          costLabel={`×${m.relativeCost}`}
          costAria={tx(t.agents.core_model_cost, { multiple: String(m.relativeCost) })}
          radio={option(m.id)}
          active={core.state.model === m.id} onClick={() => core.setModel(m.id)} testid={`core-model-${m.id}`} />
      ))}
    </div>
  );
}

/** Effort as an ascending 4-step meter — the bars grow with reasoning depth. */
export function EffortMeter({ core }: { core: PersonaCore }) {
  const { t } = useTranslation();
  const idx = EFFORT_TIERS.findIndex((e) => e.id === core.state.effort);
  const ids = EFFORT_TIERS.map((e) => e.id);
  const option = useRovingRadio(ids, core.state.effort, core.setEffort);
  return (
    <div role="radiogroup" aria-label={t.agents.core_effort_label} className="flex items-end gap-1.5">
      {EFFORT_TIERS.map((e, i) => {
        const on = i <= idx;
        const h = 12 + i * 6; // ascending
        return (
          <Tooltip key={e.id} content={e.blurb}>
            <button type="button" onClick={() => core.setEffort(e.id)} data-testid={`core-effort-${e.id}`} {...option(e.id)}
              className="flex-1 flex flex-col items-center gap-1 cursor-pointer group">
              {/* The OFF bar is a semantic class, not an inline literal-white
                  fill: an inline style outranks the app's [data-theme^="light"]
                  overrides, so the unlit steps painted white-on-white in light
                  themes. The lit bars stay inline — they are tinted from the
                  meter's own accent, which no class can express. */}
              <span
                className={`w-full rounded-sm transition-colors ${on ? "" : "bg-secondary/60"}`}
                style={{ height: h, background: on ? colorWithAlpha(EFFORT_ACCENT, core.state.effort === e.id ? 0.9 : 0.5) : undefined }}
              />
              <span className={`typo-body leading-none ${core.state.effort === e.id ? "text-foreground" : "text-foreground/85 group-hover:text-foreground"}`}>{t.models[`effort_${e.id}`]}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
