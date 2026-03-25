// ---------------------------------------------------------------------------
// Shared types and helpers for Context Map
// ---------------------------------------------------------------------------

export interface ContextItem {
  id: string;
  groupId: string;
  name: string;
  description: string;
  filePaths: string[];
  keywords: string[];
  entryPoints: string[];
}

export interface ContextGroup {
  id: string;
  name: string;
  color: string;
  contexts: ContextItem[];
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
