/** FrameDetailPane - the inner layer of a frame that is not asking anything.
 *
 *  Before launch it is the frame's settings: the real picker modal for
 *  When / Apps / Events / Messages, a switch for Memory / Review, and the
 *  reference context under What. While the build runs it is read-only. Once
 *  the draft lands it shows how every capability uses this dimension. */
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { parseChannels, prettyTriggerType, triggerDetail } from "@/features/shared/glyph";
import Button from "@/features/shared/components/buttons/Button";
import { AccessibleToggle } from "@/features/shared/components/forms/AccessibleToggle";
import { RevealItem } from "@/features/shared/components/display/RevealItem";
import { useRevealTracker } from "@/hooks/utility/interaction/useProgressiveReveal";
import { useTranslation, type Translations } from "@/i18n/useTranslation";
import { getConnectorMeta } from "@/lib/connectors/connectorMeta";
import type { ComposeConfigItem } from "../../useComposeConfig";
import { FramePicture } from "./FramePicture";
import type { Frame } from "./sheetModel";
import { COPY } from "./copy";

export type DetailMode = "compose" | "locked" | "draft";

interface FrameDetailPaneProps {
  frame: Frame;
  mode: DetailMode;
  item?: ComposeConfigItem;
  rows: GlyphRow[];
  contextText?: string;
  onContextChange?: (v: string) => void;
}

function rowWords(t: Translations, dim: GlyphDimension, r: GlyphRow): string {
  switch (dim) {
    case "task": return r.summary || r.description || "";
    case "trigger": return r.triggers.map((tr) => triggerDetail(t, tr) || prettyTriggerType(t, tr.trigger_type)).join(", ");
    case "connector": return r.connectors.map((c) => c.label || getConnectorMeta(c.name).label).join(", ");
    case "message": return parseChannels(r.messageSummary).map((c) => c.type).join(", ") || r.messageSummary || "";
    case "event": return r.events.map((e) => e.description || e.event_type).join(", ");
    case "review": return r.reviewSummary ?? "";
    case "memory": return r.memorySummary ?? "";
    case "error": return r.errorSummary ?? "";
  }
}

export function FrameDetailPane({ frame, mode, item, rows, contextText, onContextChange }: FrameDetailPaneProps) {
  const { t } = useTranslation();
  const enter = useRevealTracker(frame.dim);
  const dim = frame.dim;

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <p className="typo-body text-foreground">{t.agents.glyph_dim_desc[dim]}</p>

      {!(mode === "compose" && dim === "task") && <div className="flex items-center gap-4 min-h-20 px-4 py-3 rounded-card border border-card-border bg-card-bg">
        {frame.value ? (
          <>
            <span className="flex-none"><FramePicture dim={dim} value={frame.value} large /></span>
            <span className="typo-title-lg text-foreground min-w-0">{frame.value.words}</span>
          </>
        ) : (
          <span className="typo-body text-muted">{COPY.layerNoValue}</span>
        )}
      </div>}

      {mode === "compose" && dim === "task" && onContextChange && (
        <label className="flex flex-col gap-1.5">
          <span className="typo-title">{COPY.contextTitle}</span>
          <span className="typo-caption">{COPY.contextHelp}</span>
          <textarea
            value={contextText ?? ""}
            onChange={(e) => onContextChange(e.target.value)}
            placeholder={COPY.contextPlaceholder}
            rows={6}
            className="w-full resize-none rounded-input border border-card-border bg-background/50 px-3 py-2 typo-body text-foreground focus-ring"
          />
        </label>
      )}

      {mode === "compose" && item && item.kind === "picker" && (
        <div className="flex justify-end">
          <Button variant="primary" size="md" onClick={item.onClick}>{item.active ? COPY.layerChange : COPY.layerChoose}</Button>
        </div>
      )}
      {mode === "compose" && item && item.kind === "toggle" && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-card border border-card-border">
          <span className="typo-body text-foreground">{item.active ? item.summary[0] : t.agents.glyph_dim_label[dim]}</span>
          <AccessibleToggle checked={item.active} onChange={item.onClick} label={t.agents.glyph_dim_label[dim]} />
        </div>
      )}
      {mode === "compose" && dim === "error" && <p className="typo-caption">{COPY.layerErrorNote}</p>}
      {mode === "locked" && <p className="typo-caption">{COPY.layerLockedNote}</p>}

      {mode === "draft" && rows.length > 0 && (
        <div className="flex flex-col gap-1.5 min-h-0 overflow-y-auto">
          <span className="typo-label text-muted">{COPY.layerPerCapability}</span>
          {rows.map((r, i) => {
            const used = r.presence[dim] !== "none" || dim === "task";
            const words = used ? rowWords(t, dim, r) : "";
            return (
              <RevealItem key={r.id} revealId={r.id} order={i} {...enter} className="flex items-baseline gap-3 px-3 py-2 rounded-input border border-card-border">
                <span className="typo-title text-foreground w-44 flex-none truncate">{r.title}</span>
                <span className={`typo-body min-w-0 ${used ? "text-foreground" : "text-muted"}`}>{words || (used ? COPY.capOn : COPY.layerNotUsed)}</span>
              </RevealItem>
            );
          })}
        </div>
      )}
    </div>
  );
}
