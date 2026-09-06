import { Suspense } from 'react';

import { lazyRetry } from '@/lib/lazyRetry';
import { silentCatch } from '@/lib/silentCatch';

// `MarkdownRenderer` is the heaviest leaf in the shared catalog: it pulls
// react-markdown, remark-gfm and rehype-highlight behind it. Anything that
// imports it statically pays for that pipeline at import time, whether or not
// a single character is ever rendered through it.
//
// That is what made the notepad slow to open. The pad mounts an EDITOR — a
// textarea — but `MarkdownMiniEditor` imported the renderer for its read view
// and its preview pane, so every cold open of the pad waited for a markdown
// pipeline it was not about to use. Measured 2026-09-06 by import inspection:
// the editor's only heavy dependency was this one.
//
// The deferral is safe in the way that matters: the fallback is THE SAME TEXT,
// unrendered. A reader sees their own words in a monospace-ish block for the
// frame or two the chunk takes, never a spinner and never a blank — and where
// the chunk is already warm (the app renders markdown in a dozen surfaces)
// there is no visible swap at all.
const LazyMarkdownRenderer = lazyRetry(() =>
  import('./MarkdownRenderer').then((m) => ({ default: m.MarkdownRenderer })),
);

export interface DeferredMarkdownProps {
  content: string;
  className?: string;
}

/**
 * `MarkdownRenderer` behind a chunk boundary, with the raw text as its
 * fallback. Use it anywhere the rendered output is incidental to the surface's
 * job (an editor's preview, a read view inside a form); use `MarkdownRenderer`
 * directly where rendering IS the job (chat, reports) and the wait would show.
 */
export function DeferredMarkdown({ content, className }: DeferredMarkdownProps) {
  return (
    <Suspense
      fallback={
        <div className={`whitespace-pre-wrap break-words ${className ?? ''}`}>{content}</div>
      }
    >
      <LazyMarkdownRenderer content={content} className={className} />
    </Suspense>
  );
}

/**
 * Warm the markdown chunk without rendering anything.
 *
 * Call it from a surface that is about to want rendered markdown but does not
 * yet (an editor the user is typing into, a pad that just opened), so the
 * first preview toggle is instant instead of paying the fetch then.
 */
export function prefetchMarkdownRenderer(): void {
  void import('./MarkdownRenderer').catch(silentCatch('markdown renderer prefetch'));
}
