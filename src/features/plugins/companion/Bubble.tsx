/**
 * Bubble — chat-transcript bubble. Renders one message in the companion
 * panel's body. Handles three shapes:
 *   - User: right-aligned, primary tint, plain whitespace-pre-wrap.
 *   - System (autonomous-continuation): slim centered divider with the
 *     marker text. Detected by the `[autonomous continuation` prefix the
 *     backend writes when persisting a `TurnOrigin::Autonomous` episode.
 *   - Assistant (default): left-aligned, neutral tint, markdown-rendered.
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
import type { BrainKind } from '@/api/companion';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { BrainLinksStrip } from './BrainLinksStrip';

export function Bubble({
  role,
  streaming,
  index,
  children,
  onOpenInBrain,
}: {
  role: string;
  streaming?: boolean;
  index: number;
  children: React.ReactNode;
  onOpenInBrain?: (kind: BrainKind, id: string) => void;
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
        <span className="typo-caption tracking-wide uppercase text-primary/70">
          {children as string}
        </span>
        <div className="flex-1 h-px bg-primary/20" aria-hidden />
      </div>
    );
  }

  const showBrainLinks =
    !isUser && isString && !streaming && !!onOpenInBrain;

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid={
        streaming ? 'companion-bubble-streaming' : `companion-bubble-${role}`
      }
      data-companion-bubble-role={role}
      data-companion-bubble-index={index}
    >
      <div className={`max-w-[85%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-card px-3.5 py-2.5 typo-body break-words ${
            isUser
              ? 'bg-primary/15 text-foreground whitespace-pre-wrap'
              : 'bg-foreground/5 text-foreground'
          } ${streaming ? 'opacity-90' : ''}`}
        >
          {isUser || !isString ? (
            children
          ) : (
            <MarkdownRenderer content={children as string} />
          )}
        </div>
        {showBrainLinks && (
          <BrainLinksStrip
            content={children as string}
            onOpen={onOpenInBrain}
            variant="inline"
          />
        )}
      </div>
    </div>
  );
}
