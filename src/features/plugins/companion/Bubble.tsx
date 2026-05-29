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
import { Infinity as InfinityIcon } from 'lucide-react';
import type { BrainKind } from '@/api/companion';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { stripModelDirectives } from './athenaLabels';
import { BrainLinksStrip } from './BrainLinksStrip';

export function Bubble({
  role,
  streaming,
  index,
  children,
  onOpenInBrain,
  createdAt,
  groupStart = true,
  groupEnd = true,
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
}) {
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const isString = typeof children === 'string';

  const isAutonomousMarker =
    isSystem &&
    isString &&
    (children as string).startsWith('[autonomous continuation');
  if (isAutonomousMarker) {
    return (
      <div
        className="flex items-center gap-2 my-2 px-2 text-foreground"
        data-testid="companion-autonomous-marker"
        data-companion-bubble-role="system-autonomous"
        data-companion-bubble-index={index}
      >
        <div className="flex-1 h-px bg-primary/20" aria-hidden />
        <span className="inline-flex items-center gap-1.5 typo-caption tracking-wide uppercase text-primary/70">
          <InfinityIcon className="w-3 h-3" aria-hidden />
          {children as string}
        </span>
        <div className="flex-1 h-px bg-primary/20" aria-hidden />
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

  // Hover meta row (copy + relative time). Collapsed to zero height via a
  // grid-rows 0fr→1fr trick so it adds no vertical bloat across a long
  // transcript and never shifts layout — it expands smoothly only while the
  // message row is hovered/focused. Skipped for the streaming bubble.
  const showMeta = !streaming && displayIsString;

  return (
    <div
      className={`group flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'} ${
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
            className="w-7 h-7 mt-0.5 rounded-full object-cover ring-1 ring-primary/25 shrink-0 select-none"
          />
        ) : (
          // Spacer keeps grouped bubbles aligned under the first one's body.
          <div className="w-7 shrink-0" aria-hidden />
        ))}
      <div className={`min-w-0 max-w-[85%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-card px-3.5 py-2.5 typo-body leading-relaxed break-words ${
            isUser
              ? 'bg-primary/15 border border-primary/20 text-foreground whitespace-pre-wrap'
              : 'bg-foreground/[0.06] border border-foreground/10 text-foreground shadow-elevation-1'
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
        {showBrainLinks && (
          <BrainLinksStrip
            content={displayText as string}
            onOpen={onOpenInBrain}
            variant="inline"
          />
        )}
        {showMeta && (
          <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-150 ease-out group-hover:grid-rows-[1fr] group-focus-within:grid-rows-[1fr]">
            <div className="overflow-hidden">
              <div
                className={`flex items-center gap-1 ${isUser ? 'flex-row-reverse' : ''}`}
              >
                <CopyButton text={displayText as string} iconSize="w-3 h-3" />
                {createdAt && (
                  <RelativeTime
                    timestamp={createdAt}
                    className="typo-caption text-foreground px-1"
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
