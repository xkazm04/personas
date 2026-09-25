/**
 * AthenaChatSkeleton — what the window holds for the length of its own opening
 * animation.
 *
 * Opening the chat used to mount the entire interior — transcript, alerts,
 * toolbar rail, side panel, the full-panel video watermark — inside the frame
 * that was simultaneously flying and scaling out of the orb. Measured on a warm
 * app with an EMPTY conversation, the frame did not paint for 334ms and the
 * main thread was blocked for 257ms of that: the morph had no frames to animate
 * with, which is exactly the "it lags as it opens" the operator described.
 *
 * So the frame paints first and the interior arrives when the animation is
 * done. This stands in for it — deliberately calm rather than a shimmer, since
 * the panel is scaling from 18% during the whole time it is up and a moving
 * gradient inside a moving box is just noise. It only has to say "this is a
 * conversation, and it is nearly here".
 */

export function AthenaChatSkeleton({ compact }: { compact: boolean }) {
  const gap = compact ? 'space-y-2' : 'space-y-3';
  return (
    <div
      className={`flex-1 min-h-0 ${compact ? 'px-2.5 py-2.5' : 'px-5 py-5'} ${gap}`}
      data-testid="companion-chat-skeleton"
      aria-hidden="true"
    >
      {/* Assistant, user, assistant — the silhouette of a conversation, so the
          frame reads as "chat" before a single word has rendered. */}
      <SkeletonBubble align="start" width="72%" lines={2} compact={compact} />
      <SkeletonBubble align="end" width="46%" lines={1} compact={compact} />
      <SkeletonBubble align="start" width="84%" lines={3} compact={compact} />
    </div>
  );
}

function SkeletonBubble({
  align,
  width,
  lines,
  compact,
}: {
  align: 'start' | 'end';
  width: string;
  lines: number;
  compact: boolean;
}) {
  return (
    <div className={`flex ${compact ? 'gap-1.5' : 'gap-2.5'} ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
      {align === 'start' && (
        <span className={`${compact ? 'w-5 h-5' : 'w-7 h-7'} mt-0.5 shrink-0 rounded-full bg-foreground/[0.06]`} />
      )}
      <div
        className={`rounded-card bg-foreground/[0.04] border border-foreground/[0.06] ${
          compact ? 'px-2.5 py-1.5 space-y-1.5' : 'px-3.5 py-2.5 space-y-2'
        }`}
        style={{ width }}
      >
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className="block h-2 rounded-full bg-foreground/[0.07]"
            // Ragged right edge on the last line, like real prose.
            style={{ width: i === lines - 1 && lines > 1 ? '62%' : '100%' }}
          />
        ))}
      </div>
    </div>
  );
}
