/** usePromoteView — what promote will arm, repair and refuse, for the verdict
 *  act. Ported from the retired GlyphTestCompleteCore (b6a4e1e304): the
 *  read-only promote preview is fetched while the draft sits at test_complete
 *  and again whenever the operator removes a capability (the same exclusion
 *  list promote honours). A missing or failed preview is the permissive view:
 *  only a refusal ever blocks Promote. */
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "@/stores/agentStore";
import { usePromotePreview } from "@/features/agents/sub_glyph/usePromotePreview";
import { toPromoteView, type PromoteView } from "@/features/agents/sub_glyph/promotePreviewModel";

/** Stable empty list so the store selector does not re-render on every read. */
const EMPTY_IDS: readonly string[] = [];

export function usePromoteView(): PromoteView {
  const args = useAgentStore(
    useShallow((s) => {
      const sess = s.activeBuildSessionId ? s.buildSessions[s.activeBuildSessionId] : null;
      return {
        sessionId: sess?.sessionId ?? null,
        personaId: sess?.personaId ?? null,
        phase: sess?.phase ?? null,
        excludedIds: sess?.excludedCapabilityIds ?? EMPTY_IDS,
      };
    }),
  );
  return toPromoteView(usePromotePreview(args));
}
