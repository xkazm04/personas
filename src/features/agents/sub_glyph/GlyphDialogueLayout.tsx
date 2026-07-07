/** GlyphDialogueLayout — compose-surface prototype "Dialogue" (2026-07-07).
 *
 *  Metaphor: building an agent is a guided conversation. The compose surface
 *  reads top-to-bottom as a dialogue — the app asks "what should this do?",
 *  the user answers in a prominent composer, and the remaining dimensions are
 *  offered as tunable chips rather than a wall of form rows. A forming-persona
 *  sigil + live blueprint rail on the right fills in as each dimension is set,
 *  so the multi-round gathering has a visible, animated payoff. Ranked recipe
 *  "starters" surface from the intent so the user can choose from the option
 *  space instead of staring at it.
 *
 *  Diverges from the baseline (radial single-sigil w/ center textarea) by
 *  making the CONVERSATION the layout. Post-compose it delegates to the shared
 *  GlyphStageSurface so build → test → promote is identical to every surface.
 */
import { useAgentStore } from "@/stores/agentStore";
import { GlyphTopBar } from "./GlyphTopBar";
import { DialogueStageSurface } from "./DialogueStageSurface";
import { DialogueComposePanel } from "./DialogueComposePanel";
import { useComposeConfig } from "./useComposeConfig";
import { useRecipeStarters } from "./useRecipeStarters";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

export function GlyphDialogueLayout(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, launchDisabled,
    isBuilding, buildPhase, agentName, onAgentNameChange,
    hasDesignResult, pendingQuestions,
    onQuickConfigChange, initialNotificationChannels,
  } = props;

  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const isCompose = buildSessionId === null && !hasDesignResult;
  const hasPending = (pendingQuestions?.length ?? 0) > 0;

  const cfg = useComposeConfig({
    intentText, onIntentChange, onLaunch, onQuickConfigChange,
    initialNotificationChannels, resetKey: buildSessionId,
  });
  const starters = useRecipeStarters(intentText);

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1" data-testid="build-layout-dialogue">
      <div className="flex flex-col items-center pb-14 pt-4">
        <div className="w-full max-w-[1200px] flex flex-col items-center gap-3">
          <GlyphTopBar
            agentName={agentName}
            onAgentNameChange={onAgentNameChange}
            isPreBuild={isCompose}
            isBuilding={isBuilding}
            buildPhase={buildPhase}
            face="glyph"
            onFaceChange={() => {}}
            editLocked={hasPending}
          />

          {isCompose ? (
            <DialogueComposePanel
              intentText={intentText}
              onIntentChange={onIntentChange}
              onLaunch={cfg.launch}
              launchDisabled={launchDisabled}
              cfg={cfg}
              starters={starters}
            />
          ) : (
            <DialogueStageSurface {...props} />
          )}
        </div>
      </div>

      {cfg.modals}
    </div>
  );
}
