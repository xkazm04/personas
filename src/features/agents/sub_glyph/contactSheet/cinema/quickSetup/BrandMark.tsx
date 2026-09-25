/** BrandMark - a connector's brand logo on a soft square of its own colour.
 *  Falls back to a plug when the connector ships no icon. */
import { Plug } from "lucide-react";
import type { ConnectorMeta } from "@/lib/connectors/connectorMeta";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { ComposerBrandIcon } from "@/features/agents/sub_glyph/commandPanel/composer/ComposerBrandIcon";

export function BrandMark({ meta, size = 32 }: { meta: ConnectorMeta; size?: number }) {
  const glyph = Math.round(size * 0.55);
  return (
    <span
      aria-hidden
      className="shrink-0 rounded-interactive flex items-center justify-center overflow-hidden"
      style={{ width: size, height: size, background: colorWithAlpha(meta.color, 0.15) }}
    >
      {meta.iconUrl
        ? <ComposerBrandIcon iconUrl={meta.iconUrl} color={meta.color} size={glyph} />
        : <Plug style={{ width: glyph, height: glyph, color: meta.color }} />}
    </span>
  );
}
