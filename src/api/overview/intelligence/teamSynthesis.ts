import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export interface TeamSynthesisResult {
  team_id: string;
  team_name: string;
  member_count: number;
  description: string;
}

export async function synthesizeTeamFromTemplates(
  query: string,
  teamName: string,
): Promise<TeamSynthesisResult> {
  return invoke<TeamSynthesisResult>("synthesize_team_from_templates", {
    query,
    teamName,
  });
}
