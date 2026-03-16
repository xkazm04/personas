/**
 * Cell state machine -- maps each CellBuildStatus to a set of Tailwind classes.
 *
 * Each status maps to a config object with border, bg, opacity, and interactive
 * properties. Consumers should apply border/bg/opacity as Tailwind classes and
 * use `interactive` to gate pointer-events / click handlers.
 *
 * NOTE: Consumers should use
 *   transition-[opacity,transform,border-color,background-color]
 * instead of `transition-all` to avoid animating box-shadow.
 */
import type { CellBuildStatus } from "@/lib/types/buildTypes";

// -- Config type --------------------------------------------------------------

export interface CellStateConfig {
  /** Tailwind border class(es). */
  border: string;
  /** Tailwind background class(es). */
  bg: string;
  /** Tailwind opacity class. */
  opacity: string;
  /** Whether the cell accepts pointer interactions in this state. */
  interactive: boolean;
  /** CSS class(es) for the pseudo-element glow overlay. Empty string = no glow. */
  glow: string;
  /** Tailwind opacity class for watermark icon per state. */
  watermarkOpacity: string;
}

// -- State-to-class mapping ---------------------------------------------------

export const CELL_STATE_CLASSES: Record<CellBuildStatus, CellStateConfig> = {
  hidden: {
    border: "border-transparent",
    bg: "bg-transparent",
    opacity: "opacity-0",
    interactive: false,
    glow: "",
    watermarkOpacity: "opacity-0",
  },
  revealed: {
    border: "border-card-border/30",
    bg: "bg-card-bg/10",
    opacity: "opacity-100",
    interactive: false,
    glow: "",
    watermarkOpacity: "opacity-[0.08]",
  },
  pending: {
    border: "border-primary/20",
    bg: "bg-card-bg/30",
    opacity: "opacity-100",
    interactive: false,
    glow: "cell-glow cell-glow-pending",
    watermarkOpacity: "opacity-[0.10]",
  },
  filling: {
    border: "border-primary/30",
    bg: "bg-card-bg/60",
    opacity: "opacity-100",
    interactive: false,
    glow: "cell-glow cell-glow-filling",
    watermarkOpacity: "opacity-[0.15]",
  },
  resolved: {
    border: "border-emerald-500/30",
    bg: "bg-card-bg",
    opacity: "opacity-100",
    interactive: true,
    glow: "cell-glow cell-glow-resolved",
    watermarkOpacity: "opacity-[0.20]",
  },
  highlighted: {
    border: "border-primary/50",
    bg: "bg-card-bg",
    opacity: "opacity-100",
    interactive: true,
    glow: "cell-glow cell-glow-highlighted",
    watermarkOpacity: "opacity-[0.20]",
  },
  updated: {
    border: "border-amber-400/50",
    bg: "bg-amber-500/5",
    opacity: "opacity-100",
    interactive: true,
    glow: "cell-glow cell-glow-updated",
    watermarkOpacity: "opacity-[0.20]",
  },
  error: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    opacity: "opacity-100",
    interactive: true,
    glow: "cell-glow cell-glow-error",
    watermarkOpacity: "opacity-[0.15]",
  },
};

// -- Helper -------------------------------------------------------------------

/**
 * Returns the CellStateConfig for a given status string.
 * Falls back to the 'hidden' config for unknown values (graceful degradation).
 */
export function getCellStateClasses(status: string): CellStateConfig {
  return (
    CELL_STATE_CLASSES[status as CellBuildStatus] ?? CELL_STATE_CLASSES.hidden
  );
}
