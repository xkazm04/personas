import { useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import type { Persona } from '@/lib/bindings/Persona';

/* ----------------------------------------------------------------------------
 * Lean persona-index hook — deliberately its own module.
 *
 * `usePersonaIndex` is consumed from two places on the always-mounted app
 * shell (LiveChannelOverlay → MergedRow, via the merged-channel feed), so it
 * must never drag in anything heavy. It used to live in `boardShared.tsx`,
 * which also pulls in `MarkdownRenderer` (react-markdown/remark-gfm/
 * rehype-highlight/lowlight/highlight.js/dompurify — ~337 KB) for the
 * assignment-board's step output viewer. Importing just this hook from that
 * file was enough to drag the whole module — and its markdown stack — into
 * the eager App.tsx bundle. `boardShared.tsx` re-exports this hook for its
 * existing (lazy-loaded) consumers; new eager call sites should import it
 * from here directly.
 * -------------------------------------------------------------------------- */

/** Map persona ids to personas once per render tree. */
export function usePersonaIndex(): Map<string, Persona> {
  const personas = useAgentStore((s) => s.personas) as Persona[];
  return useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);
}
