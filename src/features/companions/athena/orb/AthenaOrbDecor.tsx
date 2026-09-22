/**
 * The orb's decorations — glows, the unread badge, the activity halo, and the
 * caption. Pure presentation: every one of these takes what it draws as props
 * and owns no state, so the orb shell stays about gesture and layout.
 */

import { MessageSquareText } from 'lucide-react';
import type { RefObject } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { splitOnMention, type ResolvedMention } from './athenaOrbMention';

/**
 * Speaking bloom. When motion is allowed the node is driven imperatively from
 * the live TTS level (see `useAthenaOrbAudioGlow`), so it takes a ref rather
 * than re-rendering at frame rate. Under reduced motion it is a static bloom.
 */
export function OrbSpeakingGlow({
  reduceMotion,
  glowRef,
}: {
  reduceMotion: boolean;
  glowRef: RefObject<HTMLSpanElement | null>;
}) {
  if (reduceMotion) {
    return <span aria-hidden className="absolute -inset-1.5 rounded-full bg-primary/30 blur-md" />;
  }
  return (
    <span
      ref={glowRef}
      aria-hidden
      className="absolute -inset-1.5 rounded-full bg-primary/40 blur-md"
      style={{ opacity: 0.3, transform: 'scale(1)', willChange: 'opacity, transform' }}
    />
  );
}

/** One-shot blooms: the message-reaction pulse and the forward-ack. */
export function OrbPulseGlow({ tone, reduceMotion }: { tone: 'primary' | 'amber'; reduceMotion?: boolean }) {
  const color = tone === 'amber' ? 'bg-amber-400/55' : 'bg-primary/55';
  return (
    <span
      aria-hidden
      className={`absolute -inset-1.5 rounded-full ${color} blur-md ${reduceMotion ? '' : 'animate-pulse'}`}
    />
  );
}

/**
 * Unread-message badge. Bottom-LEFT on purpose: the top arc belongs to the task
 * dots, top-right to dismiss and bottom-right to quick-input, so this is the one
 * corner where it can never be mistaken for a control.
 *
 * Deliberately NOT `pointer-events-none`: the badge hangs past the orb's
 * circular edge, and border-radius clips hit-testing — so an inert badge would
 * sit in dead space and a user who clicked the very thing telling them they have
 * messages would get nothing. As a plain span inside the orb button its pointer
 * events bubble into the orb's own tap/hold/drag gestures, so clicking it opens
 * the chat exactly like clicking her does.
 */
export function OrbUnreadBadge({
  count,
  label,
  reduceMotion,
}: {
  count: number;
  label: string;
  reduceMotion: boolean;
}) {
  return (
    <span
      aria-hidden
      data-testid="companion-orb-unread"
      data-unread-count={count}
      title={label}
      className="absolute -bottom-1 -left-1 inline-flex items-center justify-center gap-0.5 h-5 min-w-[1.25rem] px-1 rounded-full bg-primary text-background ring-2 ring-background shadow-elevation-2"
    >
      {!reduceMotion && <span className="absolute inset-0 rounded-full bg-primary/60 animate-ping" />}
      <MessageSquareText className="relative w-3 h-3 shrink-0" />
      {count > 1 && (
        <span className="relative typo-caption font-semibold leading-none tabular-nums">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </span>
  );
}

/** Perimeter task dots — one per in-flight background task. */
export function OrbTaskDots({
  dots,
  total,
  reduceMotion,
}: {
  dots: Array<{ left: number; top: number; delay: number }>;
  total: number;
  reduceMotion: boolean;
}) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0"
      data-testid="companion-orb-task-dots"
      data-task-count={total}
    >
      {dots.map((d, i) => (
        <span
          key={i}
          className={`absolute w-2 h-2 rounded-full bg-blue-400 ring-2 ring-background shadow-elevation-1 ${
            reduceMotion ? '' : 'animate-pulse'
          }`}
          style={{
            left: d.left,
            top: d.top,
            transform: 'translate(-50%, -50%)',
            animationDelay: `${d.delay}s`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Interim-dictation / status caption, flipped to whichever side has room.
 * Wraps instead of truncating — a cut-off "Preparing an explanat…" reads as
 * broken; the cap only bounds line length.
 */
export function OrbCaption({
  text,
  dockedLeft,
  mention,
  onFollow,
}: {
  text: string;
  dockedLeft: boolean;
  /** A resolved board node named in `text`, or null for plain prose. */
  mention?: ResolvedMention | null;
  onFollow?: (key: string) => void;
}) {
  const { t, tx } = useTranslation();
  const parts = mention ? splitOnMention(text, mention) : null;

  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 w-max max-w-[320px] px-3 py-1.5 rounded-card bg-background/95 border border-primary/30 shadow-elevation-3 typo-caption text-foreground break-words ${
        dockedLeft ? 'left-full ml-2' : 'right-full mr-2'
      }`}
    >
      {/* The bubble is `pointer-events-none` at the LAYER, so the button below
          re-enables them for itself alone — the caption must never become a
          click shield over the board it is describing. */}
      {parts && mention && onFollow ? (
        <>
          {parts.before}
          <button
            type="button"
            onClick={() => onFollow(mention.key)}
            aria-label={tx(t.plugins.companion.orb_focus_node, { name: parts.label })}
            data-testid="orb-caption-focus"
            className="pointer-events-auto rounded-interactive font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary focus-ring"
          >
            {parts.label}
          </button>
          {parts.after}
        </>
      ) : (
        text
      )}
    </div>
  );
}
