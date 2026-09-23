/** WildCentre: picks what the centre frame shows for the current act. */
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { PersonaCore } from "../../personaCore";
import { CentreCompose } from "./CentreCompose";
import { CentreSlate } from "./CentreSlate";
import { CentreDraft } from "./CentreDraft";
import { CentrePremiere } from "./CentrePremiere";
import { CentreFogged, CentreQuestions } from "./CentreMisc";
import type { FrameModel } from "./frameModel";
import type { Act, Who } from "./useReel";
import type { Focus } from "./useWildFocus";

interface WildCentreProps {
  act: Act;
  props: GlyphFullLayoutProps;
  clock: { spans: { who: Who; secs: number }[]; total: number; firstTake: number };
  frames: Record<GlyphDimension, FrameModel>;
  promoting: boolean;
  pendingLabels: string[];
  core: PersonaCore;
  onLaunch: () => void;
  onOpen: (f: Focus | null) => void;
  onResume: () => void;
  onPromote: () => void;
  onPromoteForce: () => void;
  onShowReport: () => void;
  onShowSimulate: () => void;
}

export function WildCentre(c: WildCentreProps) {
  const p = c.props;
  const takes = c.clock.spans.filter((s) => s.who === "model").length;
  switch (c.act) {
    case "compose":
      return (
        <CentreCompose
          intentText={p.intentText}
          onIntentChange={p.onIntentChange}
          onLaunch={c.onLaunch}
          launchDisabled={p.launchDisabled}
          hasNotes={!!p.contextText?.trim()}
          onOpenNotes={() => c.onOpen({ kind: "notes" })}
          core={c.core}
        />
      );
    case "exposure":
    case "wiring":
    case "screening":
      return (
        <CentreSlate
          mode={c.act}
          agentName={p.agentName}
          total={c.clock.total}
          firstTake={c.clock.firstTake}
          takes={takes}
          cliOutputLines={p.cliOutputLines}
          testOutputLines={p.testOutputLines}
        />
      );
    case "questions":
      return <CentreQuestions waiting={c.pendingLabels.length} labels={c.pendingLabels} onResume={c.onResume} />;
    case "draft":
    case "verdict":
      return (
        <CentreDraft
          verdict={c.act === "verdict"}
          agentName={p.agentName}
          onAgentNameChange={p.onAgentNameChange}
          completeness={p.completeness}
          rows={p.glyphRows}
          testPassed={p.testPassed}
          testError={p.testError}
          promoting={c.promoting}
          onStartTest={p.onStartTest}
          onPromote={c.onPromote}
          onPromoteForce={p.onPromoteForce ? c.onPromoteForce : undefined}
          onRejectTest={p.onRejectTest}
          onOpenRefine={p.onRefine ? () => c.onOpen({ kind: "refine" }) : undefined}
          onOpenPrints={() => c.onOpen({ kind: "prints" })}
          onShowReport={c.onShowReport}
          onShowSimulate={c.onShowSimulate}
        />
      );
    case "premiere": {
      const f = c.frames;
      const billing = [f.trigger, f.message].filter((m) => m.state === "developed" && m.caption).map((m) => m.caption).join(" · ");
      return <CentrePremiere agentName={p.agentName} rows={p.glyphRows} billing={billing} onViewAgent={p.onViewAgent} />;
    }
    case "fogged":
      return (
        <CentreFogged
          error={p.buildError ?? p.testError ?? null}
          onRetry={p.onRefine && p.hasDesignResult ? () => c.onOpen({ kind: "refine" }) : undefined}
        />
      );
  }
}
