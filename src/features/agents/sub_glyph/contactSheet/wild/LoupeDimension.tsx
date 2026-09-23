/** LoupeDimension: a frame's inner page.
 *
 *  Before launch it is the settings door for that dimension: the value you set
 *  and the real picker (schedule, apps, events, channels open their existing
 *  modals; memory and review are switches). After launch it is the enlargement:
 *  the frame's picture at full size, then every capability's own contribution
 *  to this dimension, straight from the capability rows. */
import { DIM_META } from "@/features/shared/glyph";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import type { Translations } from "@/i18n/en";
import type { ComposeConfigItem } from "../../useComposeConfig";
import { FramePicture } from "./FramePicture";
import { dimLines, type FrameModel } from "./frameModel";
import { COPY } from "./wildCopy";

interface LoupeDimensionProps {
  t: Translations;
  dim: GlyphDimension;
  model: FrameModel;
  composeItem: ComposeConfigItem | null;
  compose: boolean;
  rows: GlyphRow[];
}

export function LoupeDimension({ t, dim, model, composeItem, compose, rows }: LoupeDimensionProps) {
  const color = DIM_META[dim].color;
  const used = rows.filter((r) => r.presence[dim] !== "none");
  return (
    <div className="grid gap-6 max-w-[980px] mx-auto" style={{ gridTemplateColumns: "minmax(220px, 300px) 1fr" }}>
      <div className="flex flex-col gap-3">
        <div className="csw-printbox relative flex items-center justify-center rounded-input" style={{ aspectRatio: "4 / 3", background: "var(--cs-print)", color: "var(--cs-print-ink)", boxShadow: "0 20px 40px -20px rgba(0,0,0,.6), 0 0 0 10px var(--cs-print)" }}>
          {model.picture ? <FramePicture picture={model.picture} /> : <span className="csw-neg" style={{ borderColor: "rgba(0,0,0,.2)" }} />}
          <span className="absolute left-3 right-3 bottom-2 csw-edge truncate" style={{ color: "var(--cs-print-ink)", borderLeft: `3px solid ${color}`, paddingLeft: 6 }}>{model.caption || COPY.frame.blank}</span>
        </div>
        {model.by && <span className="csw-edge" style={{ color: "var(--cs-faint)" }}>{model.by === "you" ? COPY.frame.you : COPY.frame.ai}</span>}
      </div>

      <div className="flex flex-col gap-4 min-w-0">
        {compose ? (
          composeItem ? (
            <>
              <p className="csw-body m-0" style={{ color: "var(--cs-ink)", fontSize: 16 }}>
                {composeItem.summary.length ? composeItem.summary.join(" · ") : COPY.loupe.notSetYet}
              </p>
              {composeItem.kind === "input" ? (
                <p className="csw-body m-0">{COPY.loupe.taskNote}</p>
              ) : composeItem.kind === "toggle" ? (
                <button type="button" role="switch" aria-checked={composeItem.active} className="csw-opt" style={{ maxWidth: 320 }} onClick={composeItem.onClick}>
                  <span className="relative inline-block w-10 h-5 rounded-full" style={{ background: composeItem.active ? "var(--cs-safe)" : "var(--cs-hair)" }}>
                    <span className="absolute top-0.5 w-4 h-4 rounded-full transition-transform" style={{ left: 2, background: "#fff", transform: composeItem.active ? "translateX(20px)" : "none" }} />
                  </span>
                  {composeItem.active ? COPY.loupe.on : COPY.loupe.off}
                </button>
              ) : (
                <button type="button" className="csw-btn self-start" onClick={composeItem.onClick} autoFocus>
                  {composeItem.active ? COPY.loupe.change : COPY.loupe.choose}
                </button>
              )}
            </>
          ) : (
            <p className="csw-body m-0">{COPY.loupe.decidedInBuild}</p>
          )
        ) : used.length === 0 ? (
          <p className="csw-body m-0">{model.state === "latent" || model.state === "blank" ? COPY.loupe.decidedInBuild : COPY.loupe.nothingHere}</p>
        ) : (
          <>
            <span className="csw-edge">{COPY.loupe.perCapability}</span>
            <ol className="m-0 p-0 list-none flex flex-col gap-3">
              {used.map((r, i) => (
                <li key={r.id} className="flex gap-3 pb-3" style={{ borderBottom: "1px solid var(--cs-hair)" }}>
                  <span className="csw-edge shrink-0" style={{ color: "var(--cs-faint)", paddingTop: 3 }}>{String(i + 1).padStart(2, "0")}A</span>
                  <div className="flex flex-col gap-1 min-w-0">
                    <strong style={{ fontSize: 15 }}>{r.title}</strong>
                    {dimLines(t, dim, r).filter(Boolean).map((l, j) => (
                      <span key={j} style={{ fontSize: 14, color: "var(--cs-dim)", lineHeight: 1.5 }}>{l}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
