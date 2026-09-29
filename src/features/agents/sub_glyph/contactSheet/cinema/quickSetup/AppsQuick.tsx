/** AppsQuick - the Apps page's inline setup: the user's vault connectors as
 *  brand tiles, one click to attach or detach. Healthy ones come first;
 *  a connector whose check failed (or never ran) is still shown, dimmed and
 *  labelled, so it can be picked on purpose but never reads as the default.
 *  A selected database connector gets its table scope right under the tiles,
 *  as the full picker offered it. The picker modal stays the "more" path. */
import { Check } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { ComposeQuickSetup } from "@/features/agents/sub_glyph/useComposeConfig";
import { ConnectorTableScopeRow } from "@/features/agents/sub_glyph/commandPanel/composer/ConnectorTableScopeRow";
import { useVaultConnectorTiles, type VaultTile } from "./useVaultConnectorTiles";
import { BrandMark } from "./BrandMark";
import { MoreButton } from "./MoreButton";
import { QS } from "./copy";

/** Tiles shown inline before the rest move behind "All apps". */
const INLINE_LIMIT = 9;

function AppTile({ tile, on, onToggle }: { tile: VaultTile; on: boolean; onToggle: () => void }) {
  const color = tile.meta.color;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`relative flex items-center gap-2.5 p-2 rounded-card border text-left transition-colors ${
        on ? "" : "border-card-border hover:bg-secondary/40"
      } ${tile.usable || on ? "" : "opacity-60 hover:opacity-100"}`}
      style={on ? { borderColor: colorWithAlpha(color, 0.6), background: colorWithAlpha(color, 0.1) } : undefined}
    >
      <BrandMark meta={tile.meta} size={32} />
      <span className="flex flex-col min-w-0 flex-1">
        <span className="typo-body text-foreground truncate">{tile.meta.label}</span>
        <span className={`typo-caption truncate ${tile.usable ? "text-foreground" : "text-status-warning"}`}>
          {QS.health[tile.health] ?? tile.health}
        </span>
      </span>
      {on && (
        <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: color }}>
          <Check className="w-3 h-3 text-background" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

export function AppsQuick({ quick, onMore }: { quick: ComposeQuickSetup; onMore: () => void }) {
  const { t } = useTranslation();
  const tiles = useVaultConnectorTiles();
  const selected = quick.config.selectedConnectors;

  if (tiles.length === 0) {
    return (
      <div className="flex flex-col gap-3 items-start">
        <p className="typo-body text-foreground">{QS.noApps}</p>
        <MoreButton label={QS.moreApps(0)} onClick={onMore} />
      </div>
    );
  }

  // The first N tiles, plus any selected tile past the cut so a pick made in
  // the full picker is always visible (and removable) here.
  const head = tiles.slice(0, INLINE_LIMIT);
  const extra = tiles.slice(INLINE_LIMIT).filter((tl) => selected.includes(tl.name));
  const shown = [...head, ...extra];
  const dbSelected = tiles.filter((tl) => tl.category === "database" && selected.includes(tl.name));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
        {shown.map((tl) => (
          <AppTile key={tl.name} tile={tl} on={selected.includes(tl.name)} onToggle={() => quick.toggleConnector(tl.name)} />
        ))}
      </div>
      {dbSelected.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="typo-card-label uppercase tracking-[0.1em] text-foreground">{t.agents.glyph_db_scope_heading}</span>
          {dbSelected.map((tl) => (
            <ConnectorTableScopeRow
              key={tl.name}
              connector={tl}
              selected={quick.config.connectorTables[tl.name] ?? []}
              onChange={(next) => quick.setConnectorTables(tl.name, next)}
            />
          ))}
        </div>
      )}
      <MoreButton label={QS.moreApps(tiles.length - head.length)} onClick={onMore} />
    </div>
  );
}
