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

import { parseJsonOrDefault } from '@/lib/utils/parseJson';

export function parseJsonArray(raw: string | null | undefined): string[] {
  return parseJsonOrDefault(raw, []);
}
