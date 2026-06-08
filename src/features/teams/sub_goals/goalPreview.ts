/**
 * Flatten markdown to a clean single-line preview for line-clamped surfaces
 * (Board cards + the Map's detail nodes). The detail drawer renders full
 * markdown; here we only want readable text, so strip code-span backticks,
 * heading/list/emphasis markers, links→label, and the "(Promoted from backlog
 * idea …)" provenance footer that bloats autonomously-generated goal
 * descriptions.
 */
export function goalPreview(md: string): string {
  return md
    .replace(/\n\(Promoted from backlog idea[^)]*\)\s*$/i, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
