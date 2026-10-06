/** DetailZones - the controls of a frame, placed as labelled zones of the
 *  detail drawing. The controls are Cinema's own (QuickSetup before launch;
 *  DecidedSetup and FrameCapabilities after it), unchanged and LIVE from the
 *  first frame: only each zone's outline is drafted in the build-up (a dashed
 *  ghost, then a solid ink line wiped on), and its lettered tab sits on the
 *  outline where the leader from the figure lands. */
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import type { ComposeConfigItem } from "@/features/agents/sub_glyph/useComposeConfig";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";
import type { FrameValue } from "../cinema/useFrameValues";
import { FrameCapabilities } from "../cinema/FrameCapabilities";
import { QuickSetup, DecidedSetup, hasQuickSetup } from "../cinema/quickSetup/QuickSetup";
import { COPY as CINEMA } from "../cinema/copy";
import { WIPE } from "./DraftedFrame";
import { zoneLetter } from "./useLeaders";
import { COPY } from "./copy";

export interface Zone { id: string; label: string; node: ReactNode }

interface ZoneArgs {
  dim: GlyphDimension;
  label: string;
  desc: string;
  value: FrameValue | null;
  isCompose: boolean;
  item: ComposeConfigItem | undefined;
  rows: GlyphRow[];
}

/** The zones a frame has, in reading order. A zone with nothing to hold is
 *  not drawn (DecidedSetup itself prints nothing for a single decided line). */
export function buildZones({ dim, label, desc, value, isCompose, item, rows }: ZoneArgs): Zone[] {
  const zones: Zone[] = [];
  const quick = isCompose && item && hasQuickSetup(item);
  if (quick) zones.push({ id: "setup", label: COPY.detail.zones.setup, node: <QuickSetup item={item} label={label} /> });
  const note = isCompose ? (dim === "task" ? CINEMA.frame.preLaunchNote : CINEMA.frame.decidedLater) : null;
  if (desc || note) {
    zones.push({
      id: "purpose",
      label: COPY.detail.zones.purpose,
      node: (
        <div className="flex flex-col gap-2">
          {desc && <p className={`${quick ? "typo-body" : "typo-body-lg"} text-foreground`}>{desc}</p>}
          {note && !quick && <p className="typo-body text-foreground">{note}</p>}
        </div>
      ),
    });
  }
  if (!isCompose && value) {
    const showApps = dim === "connector" && (value.apps?.length ?? 0) > 0;
    if (showApps || value.lines.length > 1) {
      zones.push({ id: "decided", label: COPY.detail.zones.decided, node: <DecidedSetup dim={dim} apps={value.apps} lines={value.lines} /> });
    }
  }
  if (rows.length > 0) zones.push({ id: "caps", label: COPY.detail.zones.caps, node: <FrameCapabilities dim={dim} rows={rows} /> });
  return zones;
}

interface DetailZoneProps {
  zone: Zone;
  index: number;
  drawn: boolean;
  zoneRef: (el: HTMLElement | null) => void;
}

export function DetailZone({ zone, index, drawn, zoneRef }: DetailZoneProps) {
  const { shouldAnimate } = useMotion();
  return (
    <section ref={zoneRef} className="relative rounded-interactive px-4 pb-4 pt-6" aria-label={zone.label} data-testid={`annotated-zone-${zone.id}`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-interactive" style={{ border: "1px dashed var(--ink-faint)" }} />
      {drawn && (
        <motion.div
          aria-hidden
          {...(shouldAnimate ? WIPE : {})}
          className="pointer-events-none absolute inset-0 rounded-interactive"
          style={{ border: "1px solid var(--ink-dim)" }}
        />
      )}
      <span
        className="absolute -top-2.5 left-3 inline-flex items-center gap-2 px-1.5"
        style={{ ...LETTERING, color: drawn ? "var(--ink-strong)" : "var(--ink)", background: "var(--background)" }}
      >
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full"
          style={{ letterSpacing: 0, border: drawn ? "1px solid var(--ink)" : "1px dashed var(--ink-dim)" }}
        >
          {zoneLetter(index)}
        </span>
        {zone.label}
      </span>
      <div className="relative">{zone.node}</div>
    </section>
  );
}
