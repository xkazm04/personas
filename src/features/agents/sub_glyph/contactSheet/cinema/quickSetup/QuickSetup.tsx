/** QuickSetup - the first thing in a frame page's right column before launch:
 *  the dimension's one-click setup, inline, with the full picker modal kept
 *  as the "more" path. Every pick writes through useComposeConfig's quick
 *  setters, i.e. the same QuickConfigState -> onQuickConfigChange path the
 *  modals use, so the frame's picture develops as the user clicks.
 *
 *  DecidedSetup is the after-launch read: the compose picks were applied at
 *  launch (the composer resets with the session), so a page shows what was
 *  decided and points to Refine for a change, as the legacy composer did. */
import type { GlyphDimension } from "@/features/shared/glyph";
import { AccessibleToggle } from "@/features/shared/components/forms/AccessibleToggle";
import type { ComposeConfigItem } from "@/features/agents/sub_glyph/useComposeConfig";
import { getConnectorMeta } from "@/lib/connectors/connectorMeta";
import { AppsQuick } from "./AppsQuick";
import { WhenQuick } from "./WhenQuick";
import { MessagesQuick } from "./MessagesQuick";
import { EventsQuick } from "./EventsQuick";
import { MoreButton } from "./MoreButton";
import { BrandMark } from "./BrandMark";
import { useVaultConnectorTiles } from "./useVaultConnectorTiles";
import { QS } from "./copy";

/** True when this dimension has an inline quick setup (vs. a plain note). */
export function hasQuickSetup(item: ComposeConfigItem | undefined): boolean {
  return !!item && (item.kind === "toggle" || item.kind === "picker");
}

export function QuickSetup({ item, label }: { item: ComposeConfigItem; label: string }) {
  if (item.kind === "toggle") {
    return (
      <label className="flex items-center gap-3 typo-body text-foreground">
        <AccessibleToggle checked={item.active} onChange={item.onClick} label={label} />
        {item.summary[0] ?? label}
      </label>
    );
  }
  const quick = item.quick;
  if (quick) {
    if (item.dim === "connector") return <AppsQuick quick={quick} onMore={item.onClick} />;
    if (item.dim === "trigger") return <WhenQuick quick={quick} onMore={item.onClick} />;
    if (item.dim === "message") return <MessagesQuick quick={quick} onMore={item.onClick} />;
    if (item.dim === "event") return <EventsQuick quick={quick} onMore={item.onClick} />;
  }
  return <MoreButton label={QS.more} onClick={item.onClick} />;
}

/** After launch: the decided apps as brand chips (with vault health), or the
 *  decided lines, plus where a change goes now. */
export function DecidedSetup({ dim, apps, lines }: { dim: GlyphDimension; apps?: string[]; lines: string[] }) {
  const tiles = useVaultConnectorTiles();
  const showApps = dim === "connector" && (apps?.length ?? 0) > 0;
  if (!showApps && lines.length <= 1) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="typo-caption font-semibold uppercase tracking-[0.1em] text-foreground">{QS.decided}</span>
      {showApps ? (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
          {apps!.map((name) => {
            const meta = getConnectorMeta(name);
            const tile = tiles.find((tl) => tl.name === name);
            return (
              <li key={name} className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-card border border-card-border">
                <BrandMark meta={meta} size={28} />
                <span className="flex flex-col">
                  <span className="typo-body text-foreground">{meta.label}</span>
                  {tile && <span className={`typo-caption ${tile.usable ? "text-foreground" : "text-status-warning"}`}>{QS.health[tile.health]}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lines.map((l) => <li key={l} className="typo-body text-foreground">{l}</li>)}
        </ul>
      )}
    </div>
  );
}
