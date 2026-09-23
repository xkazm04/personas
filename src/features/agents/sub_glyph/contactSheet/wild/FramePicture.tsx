/** FramePicture: the small photograph a developed frame holds.
 *  Week strip + time, brand tiles, an arrow into channel tiles, a relay from
 *  another agent, a strip of numbered capability frames, or the dimension's
 *  own glyph. Pure render of a `Picture`; no data of its own. */
import { ArrowRight } from "lucide-react";
import { DIM_META, channelIcon, channelTint, triggerIcon } from "@/features/shared/glyph";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import type { Picture } from "./frameModel";

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];

function initials(s: string): string {
  const w = s.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase() || "A";
}

export function FramePicture({ picture, compact = false }: { picture: Picture; compact?: boolean }) {
  switch (picture.kind) {
    case "week":
      return (
        <div className="flex flex-col items-center gap-1.5">
          <span className="csw-week" aria-hidden>
            {WEEK.map((d, i) => <i key={i} data-on={picture.on[i] ? "true" : "false"}>{d}</i>)}
          </span>
          {picture.time && !compact && <span className="csw-bigt">{picture.time}</span>}
        </div>
      );
    case "trigger": {
      const Icon = triggerIcon(picture.type);
      return <Icon className="w-8 h-8" aria-hidden />;
    }
    case "reel":
      return (
        <span className="csw-mini" aria-hidden>
          {Array.from({ length: Math.min(compact ? 3 : 5, Math.max(1, picture.n)) }, (_, i) => <i key={i}>{i + 1}</i>)}
          {picture.n > 5 && !compact && <i>+</i>}
        </span>
      );
    case "apps":
      return (
        <span className="flex items-center gap-2" aria-hidden>
          {picture.names.slice(0, compact ? 2 : 4).map((n) => {
            const meta = getConnectorMeta(n);
            return (
              <span key={n} className="csw-tile" style={{ background: `${meta.color}33` }}>
                <ConnectorIcon meta={meta} size="w-5 h-5" />
              </span>
            );
          })}
        </span>
      );
    case "channels":
      return (
        <span className="flex items-center gap-2" aria-hidden>
          <ArrowRight className="w-5 h-5" style={{ color: "var(--cs-faint)" }} />
          {picture.types.slice(0, compact ? 2 : 3).map((c) => {
            const Icon = channelIcon(c);
            return (
              <span key={c} className="csw-tile" style={{ background: channelTint(c), color: "#fff" }}>
                <Icon className="w-5 h-5" />
              </span>
            );
          })}
        </span>
      );
    case "relay":
      return (
        <span className="flex items-center gap-2" aria-hidden>
          <span className="csw-tile csw-edge" style={{ background: "var(--cs-safe-soft)", color: "var(--cs-ink)" }}>{initials(picture.from)}</span>
          <ArrowRight className="w-5 h-5" style={{ color: "var(--cs-faint)" }} />
          <span className="csw-tile" style={{ background: "var(--cs-hair)" }} />
        </span>
      );
    case "glyph": {
      const meta = DIM_META[picture.dim];
      const Icon = meta.icon;
      return <Icon className="w-8 h-8" style={{ color: meta.color }} aria-hidden />;
    }
  }
}
