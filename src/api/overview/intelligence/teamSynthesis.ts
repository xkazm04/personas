import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { TeamSynthesisResult } from "@/lib/bindings/TeamSynthesisResult";

export type { TeamSynthesisResult } from "@/lib/bindings/TeamSynthesisResult";

/** One StructuredJson call that escalates once on rejected output (two legs of
 *  `SYNTHESIS_TIMEOUT_SECS` = 120 s each in commands/design/team_synthesis.rs),
 *  then team assembly, all inline. The IPC must outlive that budget or the UI
 *  reports failure for a team the backend goes on to create. */
export async function synthesizeTeamFromTemplates(
  query: string,
  teamName: string,
): Promise<TeamSynthesisResult> {
  return invoke<TeamSynthesisResult>("synthesize_team_from_templates", {
    query,
    teamName,
  }, { timeoutMs: 300_000 });
}
