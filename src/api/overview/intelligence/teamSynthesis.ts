import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { TeamSynthesisResult } from "@/lib/bindings/TeamSynthesisResult";

export type { TeamSynthesisResult } from "@/lib/bindings/TeamSynthesisResult";

export async function synthesizeTeamFromTemplates(
  query: string,
  teamName: string,
): Promise<TeamSynthesisResult> {
  return invoke<TeamSynthesisResult>("synthesize_team_from_templates", {
    query,
    teamName,
  });
}
