/* ── GHOSTS — what a channel shows while its FIRST page is in flight ───────── */

/** Deterministic bubble widths + sides, so the ghost reads as a conversation
 *  rather than a barcode (overview-loading §C). */
const GHOST_BUBBLES: Array<{ w: string; mine: boolean; h: number }> = [
  { w: 'w-56', mine: false, h: 44 },
  { w: 'w-40', mine: true, h: 32 },
  { w: 'w-72', mine: false, h: 60 },
  { w: 'w-48', mine: true, h: 32 },
  { w: 'w-64', mine: false, h: 44 },
  { w: 'w-36', mine: true, h: 32 },
];

/**
 * @catalog ConversationGhostRows — calm, geometry-matched chat placeholders for a channel whose first page has not landed yet.
 *
 * Law 3 of `docs/design/overview-loading.md`: the delay lives on the
 * placeholder. Each bubble enters with `animate-fade-in` behind an
 * `animation-delay` starting at 120ms, so a warm channel paints none of this —
 * it is literally invisible until the fetch has been slow enough to deserve a
 * placeholder. No `animate-pulse`, no spinner, `aria-hidden`.
 */
export function ConversationGhostRows({ count = GHOST_BUBBLES.length }: { count?: number }) {
  return (
    <div aria-hidden data-testid="conversation-ghosts" className="flex-1 min-h-0 px-3 py-2 flex flex-col justify-end gap-2 overflow-hidden">
      {GHOST_BUBBLES.slice(0, count).map((g, i) => (
        <div key={i} className={`flex ${g.mine ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`${g.w} rounded-card bg-primary/[0.06] animate-fade-in`}
            style={{ height: g.h, animationDelay: `${120 + i * 35}ms` }}
          />
        </div>
      ))}
    </div>
  );
}
