/** FigureCentre - what sits in the figure's band on sheet 1.
 *
 *  Compose: the composer itself (Cinema's ComposeCentre and recipe starters,
 *  testids intact) over the construction of the sigil, which is drawn
 *  quietly underneath while you type. After launch: the casting roll under
 *  the figure, then the crowning: the winner flies into the core ring and the
 *  name is lettered in under the figure, with the role beneath it. */
import { LayoutGroup, motion } from "framer-motion";
import { CinemaSilhouette } from "@/features/agents/sub_glyph/cinemaShared";
import { useAgentStore } from "@/stores/agentStore";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../cinema/useSheetState";
import type { CentreActions } from "../cinema/centre/ActPanel";
import { ComposeCentre } from "../cinema/centre/ComposeCentre";
import { RecipeStarters } from "../cinema/centre/RecipeStarters";
import { LETTERING } from "../blueprint";
import type { DrawingGeometry } from "./sheetGeometry";
import { CastingRoll, castLayoutId } from "./CastingRoll";
import { Lettered } from "./sheetParts";
import { COPY } from "./copy";

interface FigureCentreProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  geo: DrawingGeometry;
}

export function FigureCentre({ p, s, a, geo }: FigureCentreProps) {
  const role = useAgentStore((st) => st.buildBehaviorCore?.identity?.role ?? null);
  const { band, strip, figure } = geo;
  if (s.isCompose) {
    return (
      <div className="absolute flex items-center justify-center px-1" style={{ left: band.x, top: band.y, width: band.w, height: band.h }}>
        <ComposeCentre
          intentText={p.intentText} onIntentChange={p.onIntentChange} onLaunch={s.launch}
          launchDisabled={p.launchDisabled} launching={s.launching} core={s.core}
          hasContext={!!p.contextText?.trim()} onOpenContext={a.openContext} onOpenCore={a.openCore}
          error={p.launchError} onDismissError={p.onDismissLaunchError}
          below={<RecipeStarters recipes={s.recipes} />}
        />
      </div>
    );
  }

  const { cast } = s;
  const crowned = cast.phase === "crowned";
  const core = Math.max(28, figure.size * 0.2);
  const name = p.agentName.trim() || COPY.untitled;
  return (
    <LayoutGroup id="dsh-cast">
      {crowned && (
        <motion.span
          layoutId={castLayoutId(cast.winner.id)}
          className="absolute grid place-items-center rounded-full"
          style={{
            left: figure.cx - core / 2, top: figure.cy - core / 2, width: core, height: core,
            border: "1px solid var(--bp-accent)",
            background: "radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--bp-accent) 26%, transparent), transparent 72%)",
          }}
        >
          <CinemaSilhouette form={cast.winner.form} color={cast.winner.color} size={core * 0.7} />
        </motion.span>
      )}
      <div className="absolute flex flex-col items-center justify-end gap-0.5 text-center" style={{ left: strip.x, top: strip.y, width: strip.w, height: strip.h }}>
        {crowned ? (
          <>
            <span className="max-w-full truncate typo-heading-lg uppercase tracking-[0.14em]" style={{ color: "var(--ink-strong)" }}>
              <Lettered text={name} />
            </span>
            {role && (
              <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="max-w-full truncate" style={{ ...LETTERING, color: "var(--bp-accent)" }}>
                {role}
              </motion.span>
            )}
          </>
        ) : (
          <CastingRoll cast={cast} />
        )}
      </div>
    </LayoutGroup>
  );
}
