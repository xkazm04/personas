import type { ReactNode } from 'react';

/**
 * Wrap the first occurrence of `query` within `text` in a styled <mark>.
 * Returns plain text when there is no match or query is too short.
 */
export function highlightMatch(text: string, query: string): ReactNode {
  if (!query || query.length < 2) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-cyan-500/20 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
