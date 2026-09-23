/** FramePicture - the small "print" a developed frame shows: a week strip
 *  with the time, app tiles, an arrow into channel tiles, one agent handing
 *  an event to another. Pure presentation over a FrameValue. */
import {
  ArrowRight, Bot, Brain, Filter, Inbox, RotateCcw, UserCheck,
} from "lucide-react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { channelIcon, triggerIcon } from "@/features/shared/glyph";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { WEEK, WEEK_LETTER, type FrameValue } from "./sheetModel";

const TILE = "inline-flex items-center justify-center rounded-card border border-card-border bg-secondary shadow-elevation-1 flex-none";

function initials(label: string): string {
  const w = label.replace(/\(.*?\)/g, "").split(/[\s._-]+/).filter(Boolean);
  if (w.length === 0) return "?";
  return (w.length > 1 ? w[0]![0]! + w[1]![0]! : w[0]!.slice(0, 2)).toUpperCase();
}

export function AppTile({ name, size = 36 }: { name: string; size?: number }) {
  const meta = getConnectorMeta(name);
  return (
    <span className={TILE} style={{ width: size, height: size }} aria-label={meta.label}>
      <ConnectorIcon meta={meta} size={size >= 40 ? "w-5 h-5" : "w-4 h-4"} />
    </span>
  );
}

export function ChannelTile({ type, size = 36 }: { type: string; size?: number }) {
  const Icon = type === "built-in" ? Inbox : channelIcon(type);
  return (
    <span className={TILE} style={{ width: size, height: size }} aria-label={type}>
      <Icon className="w-4 h-4 text-foreground" />
    </span>
  );
}

function WeekStrip({ days, time }: { days: string[]; time?: string | null }) {
  return (
    <span className="flex items-center gap-3">
      <span className="inline-grid grid-cols-7 gap-0.5" aria-hidden>
        {WEEK.map((d, i) => (
          <span
            key={d}
            className={`w-4 h-6 rounded-interactive grid place-items-center typo-label ${
              days.includes(d) ? "bg-primary/25 text-foreground" : "bg-foreground/5 text-muted"
            }`}
          >
            {WEEK_LETTER[i]}
          </span>
        ))}
      </span>
      {time && <span className="typo-data-lg text-foreground">{time}</span>}
    </span>
  );
}

const BIG = "w-8 h-8 text-primary";

export function FramePicture({ dim, value, large = false }: { dim: GlyphDimension; value: FrameValue; large?: boolean }) {
  const tile = large ? 44 : 34;
  switch (dim) {
    case "trigger": {
      if (value.days && value.days.length > 0) return <WeekStrip days={value.days} time={value.time} />;
      const Icon = triggerIcon(value.triggerType ?? "manual");
      return <Icon className={BIG} />;
    }
    case "task":
      return (
        <span className="flex gap-1.5" aria-hidden>
          {Array.from({ length: Math.min(5, Math.max(1, value.count ?? 1)) }, (_, i) => (
            <span key={i} className="w-8 h-6 rounded-interactive border border-primary/40 bg-primary/10 grid place-items-center typo-label text-foreground">
              {i + 1}
            </span>
          ))}
        </span>
      );
    case "connector": {
      const apps = value.apps ?? [];
      return (
        <span className="flex items-center gap-2">
          {apps.slice(0, 4).map((a) => <AppTile key={a} name={a} size={tile} />)}
          {apps.length > 4 && <span className="typo-label text-muted">+{apps.length - 4}</span>}
        </span>
      );
    }
    case "message":
      return (
        <span className="flex items-center gap-2">
          <ArrowRight className="w-5 h-5 text-muted" aria-hidden />
          {(value.channels ?? ["built-in"]).slice(0, 3).map((c) => <ChannelTile key={c} type={c} size={tile} />)}
        </span>
      );
    case "review":
      return value.on === false ? <Filter className={BIG} /> : <UserCheck className={BIG} />;
    case "memory":
      return <Brain className={BIG} />;
    case "event":
      return (
        <span className="flex items-center gap-2">
          <span className={`${TILE} typo-label text-foreground`} style={{ width: tile, height: tile }}>{initials(value.from ?? "?")}</span>
          <ArrowRight className="w-5 h-5 text-muted" aria-hidden />
          <span className={TILE} style={{ width: tile, height: tile }}><Bot className="w-4 h-4 text-primary" /></span>
        </span>
      );
    case "error":
      return <RotateCcw className={BIG} />;
  }
}
