import { invoke } from "@tauri-apps/api/core";

export interface SmartSearchResult {
  rankedIds: string[];
  rationale: string;
  cliLog: string[];
}

export const smartSearchTemplates = (query: string) =>
  invoke<SmartSearchResult>("smart_search_templates", { query });
