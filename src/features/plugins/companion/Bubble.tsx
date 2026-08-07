/**
 * Bubble — chat-transcript bubble. Renders one message in the companion
 * panel's body. Handles three shapes:
 *   - User: right-aligned, primary tint, plain whitespace-pre-wrap.
 *   - System (autonomous-continuation): slim centered divider with the
 *     marker text. Detected by the `[autonomous continuation` prefix the
 *     backend writes when persisting a `TurnOrigin::Autonomous` episode.
 *   - Assistant (default): left-aligned with a small Athena avatar in the
 *     gutter, defined surface (tint + hairline border + faint lift), and
 *     markdown-rendered body. The avatar is a static poster image (not the
 *     `<video>` AthenaAvatar) so per-bubble cost stays at zero decode.
 *
 * Streaming bubbles use `streaming=true` to flip the testid + dim the
 * opacity. The actual streaming text is filtered upstream (CompanionPanel
 * calls `stripModelDirectives` before passing it as children) so the user
 * never sees raw OP:/QR:/TTS: directive lines.
 *
 * Brain links: when an assistant message body mentions a brain-id token
 * (goal_xyz, procedural_abc, …) and an `onOpenInBrain` handler is wired,
 * a small chip strip renders below the bubble linking each token to its
 * Brain Viewer entry. Skipped during streaming — the partial text would
 * make the chip set flicker as tokens come and go mid-reply.
 */
import { Infinity as InfinityIcon, LayoutGrid } from 'lucide-react';
import type { BrainKind } from '@/api/companion';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { stripModelDirectives } from './athenaLabels';
import { BrainLinksStrip } from './BrainLinksStrip';
import { systemMarkerOf } from './systemMarkers';

export function Bubble({
  role,
  streaming,
  index,
  children,
  onOpenInBrain,
  createdAt,
  groupStart = true,
  groupEnd = true,
  compact = false,
}: {
  role: string;
  streaming?: boolean;
  index: number;
  children: React.ReactNode;
  onOpenInBrain?: (kind: BrainKind, id: string) => void;
  /** ISO timestamp for the hover meta row. Omitted for the streaming bubble. */
  createdAt?: string;
  /** First message of a consecutive same-role run — shows the avatar. */
  groupStart?: boolean;
  /** Last of the run — actions row sits below it; spacing relaxes after. */
  groupEnd?: boolean;
  /** Slim/mobile-like layout for the panel's minimized width — tighter padding, smaller avatar, wider bubble column. */
  compact?: boolean;
}) {
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const isString = typeof children === 'string';

  // System turns that aren't the user talking and aren't Athena's prose —
  // autonomous continuations and forwarded system requests (e.g. Fleet's
  // "Ask Athena") — render as a slim labeled divider, never a user/assistant
  // bubble, so provenance reads at a glance. A `[proactive: <kind>]` opener
  // carries no user-facing prose at all, so it renders as nothing; the
  // assistant reply that follows IS what the user reads.
  const marker = isSystem && isString ? systemMarkerOf(children as string) : null;
  if (marker === 'proactive') return null;

  const isFleetMarker = marker === 'fleet';
  if (marker) {
    // The persisted body is a bracketed machine tag ("[Fleet]",
    // "[autonomous continuation #3]"). Strip the brackets and capitalize:
    // with the uppercase CSS gone, the raw form would render as literal
    // punctuation in the middle of the conversation.
    const raw = (children as string).trim().replace(/^\[|\]$/g, '');
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    const MarkerIcon = isFleetMarker ? LayoutGrid : InfinityIcon;
    return (
      <div
        className="flex items-center gap-2 my-2 px-2 text-foreground"
        data-testid={isFleetMarker ? 'companion-fleet-marker' : 'companion-autonomous-marker'}
        data-companion-bubble-role={isFleetMarker ? 'system-fleet' : 'system-autonomous'}
        data-companion-bubble-index={index}
      >
        <div className="flex-1 h-px bg-primary/20" aria-hidden />
        {/* Sentence case, not caps: a shouted label competes with the
            conversation it is only annotating. */}
        <span className="inline-flex items-center gap-1.5 typo-caption tracking-wide text-primary/70">
          <MarkerIcon className="w-3 h-3" aria-hidden />
          {label}
        </span>
        <div className="flex-1 h-px bg-primary/20" aria-hidden />
      </div>
    );
  }

  // Conversational PROGRESS aside — a beat Athena emitted mid-turn,
  // persisted as its own lightweight assistant episode (sentinel prefix
  // `PROGRESS:`). Renders as a slim, quiet line with a small dot in the
  // avatar gutter — her thinking-aloud while she works, visually distinct
  // from the considered final reply. (Live, in-flight beats are surfaced
  // separately by the streaming bubble; this is the persisted form.)
  const isAside = !isUser && !isSystem && isString && (children as string).trimStart().startsWith('PROGRESS:');
  if (isAside) {
    const beat = (children as string).trimStart().replace(/^PROGRESS:\s*/, '').trim();
    return (
      <div
        className={`group flex justify-start ${compact ? 'gap-1.5' : 'gap-2.5'} ${groupStart ? '' : '-mt-1'}`}
        data-testid="companion-bubble-aside"
        data-companion-bubble-role="assistant-aside"
        data-companion-bubble-index={index}
      >
        <div className={`flex justify-center shrink-0 ${compact ? 'w-5' : 'w-7'}`} aria-hidden>
          <span className="w-1.5 h-1.5 mt-2 rounded-full bg-primary/40" />
        </div>
        <div
          className={`min-w-0 py-0.5 typo-caption italic text-foreground/55 leading-relaxed ${
            compact ? 'max-w-[92%]' : 'max-w-[85%]'
          }`}
        >
          {beat}
        </div>
      </div>
    );
  }

  // Display-time safety net: strip any machine-grammar lines (`OP:`,
  // `QR:`, `TTS:`, raw `{"op":`) from assistant/system prose before it
  // renders. The backend dispatcher strips these on the happy path, but
  // its rejection / parse-failure / multi-line-JSON branches keep the
  // line in the persisted episode (`cleaned_lines.push(line)`), which
  // then renders raw to the user. Sanitizing here — the single point
  // every transcript bubble flows through — guarantees the user never
  // sees an OP directive regardless of which server-side branch ran.
  // User messages are passed through untouched (their text is theirs).
  const displayText =
    isString && !isUser
      ? stripModelDirectives(children as string)
      : children;
  const displayIsString = typeof displayText === 'string';

  const showBrainLinks =
    !isUser && displayIsString && !streaming && !!onOpenInBrain;

  // Hover/focus meta controls (copy + live relative time). Rendered BESIDE the
  // bubble — overlaid in the gutter via absolute positioning — so they never
  // shift layout or add vertical bloat across a long transcript. They fade in
  // only while the message row is hovered or keyboard-focused (group-hover /
  // group-focus-within), on the side away from the text: to the right of an
  // assistant bubble, to the left of a user bubble. Skipped while streaming.
  const showMeta = !streaming && displayIsString;

  const avatarSize = compact ? 'w-5 h-5' : 'w-7 h-7';
  const avatarGutter = compact ? 'w-5' : 'w-7';

  return (
    <div
      className={`group flex ${compact ? 'gap-1.5' : 'gap-2.5'} ${isUser ? 'justify-end' : 'justify-start'} ${
        groupStart ? '' : '-mt-1.5'
      } ${groupEnd ? '' : 'mb-0'}`}
      data-testid={
        streaming ? 'companion-bubble-streaming' : `companion-bubble-${role}`
      }
      data-companion-bubble-role={role}
      data-companion-bubble-index={index}
      data-group-start={groupStart ? 'true' : 'false'}
    >
      {!isUser &&
        (groupStart ? (
          <img
            src="/athena/athena_baseline.jpg"
            alt=""
            aria-hidden
            draggable={false}
            className={`${avatarSize} mt-0.5 rounded-full object-cover ring-1 ring-primary/25 shrink-0 select-none`}
          />
        ) : (
          // Spacer keeps grouped bubbles aligned under the first one's body.
          <div className={`${avatarGutter} shrink-0`} aria-hidden />
        ))}
      <div
        className={`min-w-0 flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'} ${
          compact ? 'max-w-[92%]' : 'max-w-[85%]'
        }`}
      >
        {/*
          Bubble + side controls. This wrapper shrink-wraps the bubble (it's a
          flex child of an items-start/end column), so the absolutely-positioned
          meta anchors to the bubble's own edge — not the 85% column — and floats
          in the empty gutter beside even a short message.
        */}
        <div className="relative min-w-0">
          <div
            className={`rounded-card typo-body leading-relaxed break-words ${
              compact ? 'px-2.5 py-1.5' : 'px-3.5 py-2.5'
            } ${
              isUser
                ? 'bg-primary/20 border border-primary/30 text-foreground whitespace-pre-wrap'
                : 'bg-background/80 border border-foreground/12 text-foreground shadow-elevation-1'
            } ${streaming ? 'opacity-90' : ''}`}
          >
            {isUser || !displayIsString ? (
              displayText
            ) : (
              <MarkdownRenderer
                content={displayText as string}
                className="athena-chat-md"
                codeBlockActions
              />
            )}
          </div>
          {showMeta && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1 whitespace-nowrap opacity-0 pointer-events-none transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${
                isUser ? 'right-full pr-1.5 flex-row-reverse' : 'left-full pl-1.5'
              }`}
            >
              <CopyButton text={displayText as string} iconSize="w-3 h-3" />
              {createdAt && (
                <RelativeTime
                  timestamp={createdAt}
                  className="typo-caption text-foreground/60 tabular-nums"
                />
              )}
            </div>
          )}
        </div>
        {showBrainLinks && (
          <BrainLinksStrip
            content={displayText as string}
            onOpen={onOpenInBrain}
            variant="inline"
          />
        )}
      </div>
    </div>
  );
}
