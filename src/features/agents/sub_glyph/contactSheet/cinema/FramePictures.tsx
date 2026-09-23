/** FramePictures — the small picture each developed frame prints: a week strip
 *  and time, brand tiles docking, an arrow into channel tiles, numbered
 *  capability frames. Items arrive one per beat with Cinema's springs (the
 *  same docking the Cinema coronation uses for connector chips). Frames with
 *  nothing more specific print their dimension's aura from the sigil. */
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Inbox } from "lucide-react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, channelIcon, channelTint, triggerIcon } from "@/features/shared/glyph";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { FrameValue } from "./useFrameValues";
import { useTimedReveal } from "./cinemaMotion";

const SPRING = { type: "spring", stiffness: 260, damping: 22 } as const;
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export function DimAuraMark({ dim, size, lit }: { dim: GlyphDimension; size: number; lit: boolean }) {
  const Art = DIM_META[dim].customArt;
  const Icon = DIM_META[dim].icon;
  return (
    <span className="inline-flex" style={{ color: DIM_META[dim].color, opacity: lit ? 1 : 0.28 }} aria-hidden>
      {Art ? <Art size={size} iconOpacity={lit ? 1 : 0} /> : <Icon className="w-6 h-6" />}
    </span>
  );
}

function Tile({ color, children, size }: { color: string; children: React.ReactNode; size: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-card flex-shrink-0"
      style={{ width: size, height: size, background: colorWithAlpha(color, 0.16), boxShadow: `0 0 0 1px ${colorWithAlpha(color, 0.45)}` }}
    >
      {children}
    </span>
  );
}

function Docking<T extends string>({ items, render, max }: { items: T[]; render: (item: T, i: number) => React.ReactNode; max: number }) {
  const shown = useTimedReveal(items.slice(0, max), 650);
  return (
    <AnimatePresence initial={false}>
      {shown.map((it, i) => (
        <motion.span key={it} layout initial={{ opacity: 0, scale: 0.6, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING} className="inline-flex">
          {render(it, i)}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

export function FramePicture({ dim, value, compact }: { dim: GlyphDimension; value: FrameValue; compact: boolean }) {
  const color = DIM_META[dim].color;
  const tile = compact ? 28 : 34;

  if (dim === "trigger" && value.week) {
    const week = value.week;
    return (
      <span className="flex items-center gap-3">
        <span className="inline-grid grid-cols-7 gap-[3px]">
          {DAY_LETTERS.map((l, i) => (
            <motion.i
              key={i}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, ...SPRING }}
              className="not-italic w-4 h-[22px] rounded-[3px] typo-caption leading-[22px] text-center"
              style={{ background: week.days[i] ? colorWithAlpha(color, 0.35) : "color-mix(in srgb, var(--foreground) 6%, transparent)", color: week.days[i] ? "var(--foreground)" : "var(--muted-foreground)" }}
            >
              {l}
            </motion.i>
          ))}
        </span>
        {week.time && !compact && <span className="font-mono typo-heading-lg font-semibold tracking-tight tabular-nums">{week.time}</span>}
      </span>
    );
  }
  if (dim === "trigger" && value.triggerKind) {
    const Icon = triggerIcon(value.triggerKind);
    return <Tile color={color} size={tile + 8}><Icon className="w-5 h-5" /></Tile>;
  }
  if (dim === "connector" && value.apps?.length) {
    return (
      <span className="flex items-center gap-2 flex-wrap justify-center">
        <Docking items={value.apps} max={compact ? 3 : 4} render={(a) => {
          const meta = getConnectorMeta(a);
          return <Tile color={meta.color} size={tile}><ConnectorIcon meta={meta} size="w-4 h-4" /></Tile>;
        }} />
      </span>
    );
  }
  if (dim === "message" && value.channels?.length) {
    return (
      <span className="flex items-center gap-2">
        <ArrowRight className="w-5 h-5 text-foreground" />
        <Tile color={color} size={tile}><Inbox className="w-4 h-4" /></Tile>
        <Docking items={value.channels} max={compact ? 2 : 3} render={(c) => {
          const Icon = channelIcon(c);
          return <Tile color={channelTint(c)} size={tile}><Icon className="w-4 h-4" /></Tile>;
        }} />
      </span>
    );
  }
  if (dim === "task" && value.caps?.length) {
    return (
      <span className="flex items-center gap-1.5">
        <Docking items={value.caps} max={compact ? 4 : 5} render={(_c, i) => (
          <span className="w-8 h-6 rounded-[3px] grid place-items-center typo-caption font-mono" style={{ border: `1.5px solid ${colorWithAlpha(color, 0.75)}`, background: colorWithAlpha(color, 0.14) }}>
            {i + 1}
          </span>
        )} />
      </span>
    );
  }
  if (dim === "event" && value.events?.length) {
    return (
      <span className="flex items-center gap-2">
        <Tile color={color} size={tile}><span className="typo-caption font-semibold">{value.events[0]!.slice(0, 2).toUpperCase()}</span></Tile>
        <ArrowRight className="w-5 h-5 text-foreground" />
        <DimAuraMark dim="event" size={tile + 6} lit />
      </span>
    );
  }
  return <DimAuraMark dim={dim} size={compact ? 40 : 52} lit />;
}
