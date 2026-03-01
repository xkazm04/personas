import { invoke } from "@tauri-apps/api/core";

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
