import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';

export function mergeMemories(a: PersonaMemory, b: PersonaMemory): {
  persona_id: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  tags: string[];
} {
  // Keep higher importance, merge content, combine tags
  const tagsA: string[] = a.tags ? (() => { try { return JSON.parse(a.tags); } catch { return []; } })() : [];
  const tagsB: string[] = b.tags ? (() => { try { return JSON.parse(b.tags); } catch { return []; } })() : [];
  const mergedTags = [...new Set([...tagsA, ...tagsB])];

  // Use the newer memory's persona as the owner
  const newer = new Date(a.created_at) > new Date(b.created_at) ? a : b;

  // Combine content
  const contentA = stripHtml(a.content).trim();
  const contentB = stripHtml(b.content).trim();
  const mergedContent = contentA === contentB
    ? contentA
    : `${contentA}\n\n---\n\n${contentB}`;

  return {
    persona_id: newer.persona_id,
    title: stripHtml(newer.title),
    content: mergedContent,
    category: newer.category,
    importance: Math.max(a.importance, b.importance),
    tags: mergedTags,
  };
}
