import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, History } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useStudioStore } from './studioStore';
import StudioDecision from './StudioDecision';

// Smooth letter-level reveal of a growing stream (1b). `count` chases
// target.length; the step scales with the backlog so a big CLI chunk catches up
// without lagging, while a trickle types at a readable pace. Resets to 0 when the
// stream clears at the start of a new turn.
function useTypewriter(target: string): string {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  countRef.current = count;
  useEffect(() => {
    if (target.length < countRef.current) setCount(target.length);
  }, [target]);
  useEffect(() => {
    if (count >= target.length) return;
    const step = Math.max(1, Math.round((target.length - count) / 18));
    const t = window.setTimeout(() => setCount((c) => Math.min(target.length, c + step)), 16);
    return () => window.clearTimeout(t);
  }, [count, target]);
  return target.slice(0, Math.min(count, target.length));
}

const BUBBLE =
  'pointer-events-auto flex max-w-full items-start gap-2 self-start rounded-modal border border-border bg-background/95 px-3 py-2 shadow-elevation-4 backdrop-blur';

// Earlier messages are a *reading* surface, not a floating hint — so they get a
// fully opaque background (no /95, no element opacity). The translucent version
// let the preview and the latest bubble bleed through the text underneath it.
const HISTORY_BUBBLE =
  'pointer-events-auto flex max-w-full items-start gap-2 self-start rounded-modal border border-border bg-background px-3 py-2 shadow-elevation-4';

const Working = ({ autonomous, name }: { autonomous: boolean; name: string }) => (
  <span className="flex items-center gap-1.5 text-md text-foreground/80">
    {autonomous ? `Building ${name} autonomously` : 'Athena is working'}
    <span className="flex gap-0.5">
      <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:300ms]" />
    </span>
  </span>
);

// Athena's responses. Two modes:
// - default (dock, collapsed): only the latest turn as a floating bubble, with an
//   icon button to reveal earlier ones — keeps the preview immersive.
// - expanded: a full, readable conversation column (all turns + live stream +
//   decision), meant to fill the dock's scrollable panel body.
export default function StudioMessages({ expanded = false }: { expanded?: boolean }) {
  const activeId = useStudioStore((s) => s.activeId);
  const rt = useStudioStore((s) => (s.activeId ? s.runtimes[s.activeId] : undefined));
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const [showAll, setShowAll] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const streamRaw = rt
    ? (rt.stream.split('BUILD_PLAN:')[0]?.split('NEEDS_INPUT:')[0] ?? '').trimEnd()
    : '';
  const typed = useTypewriter(rt?.busy ? streamRaw : '');

  // Keep the expanded conversation pinned to the newest content as it streams.
  useEffect(() => {
    if (expanded) endRef.current?.scrollIntoView({ block: 'end' });
  }, [expanded, typed, rt?.messages.length, rt?.question]);

  if (!activeId || !rt) return null;
  const { busy, question, options, messages, autonomous, name } = rt;
  if (!busy && messages.length === 0 && question === null) return null;

  const decision = question ? (
    <StudioDecision
      question={question}
      options={options}
      onAnswer={(a) => void sendTurn(activeId, a)}
    />
  ) : null;

  // ── Expanded: the full conversation as a readable column ──────────────────
  if (expanded) {
    return (
      <div className="flex flex-col gap-2.5">
        {messages.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-1.5 typo-caption text-foreground/40">
                <span className="font-medium text-foreground/65">Athena</span>
                <span>·</span>
                <RelativeTime timestamp={m.ts} />
              </div>
              <MarkdownRenderer content={m.text} className="athena-chat-md" codeBlockActions />
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-start gap-2">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {typed ? (
              <div className="min-w-0 flex-1">
                <MarkdownRenderer content={typed} className="athena-chat-md" />
              </div>
            ) : (
              <Working autonomous={autonomous} name={name} />
            )}
          </div>
        )}
        {decision && <div className="pl-6">{decision}</div>}
        <div ref={endRef} />
      </div>
    );
  }

  // ── Collapsed: latest bubble only, with a reveal-earlier affordance ───────
  const history = messages.slice(0, -1);
  const latest = messages[messages.length - 1];
  const canExpand = history.length > 0;

  return (
    <div className="pointer-events-none flex flex-col items-start gap-1.5">
      {canExpand && (
        <button
          type="button"
          data-testid="studio-messages-toggle"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="pointer-events-auto inline-flex items-center gap-1 self-start rounded-full border border-border bg-background/85 px-2 py-0.5 typo-caption text-foreground/60 shadow-elevation-2 backdrop-blur transition-colors hover:text-foreground"
        >
          <History className="h-3 w-3" />
          {showAll ? 'Hide earlier' : `${history.length} earlier ${history.length === 1 ? 'message' : 'messages'}`}
        </button>
      )}

      <AnimatePresence initial={false}>
        {showAll && canExpand && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="flex max-h-[42vh] w-full flex-col gap-1.5 overflow-y-auto"
          >
            {history.map((m) => (
              <div key={m.id} className={HISTORY_BUBBLE}>
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
                <div className="min-w-0">
                  <MarkdownRenderer content={m.text} className="athena-chat-md" />
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={busy ? 'busy' : (latest?.id ?? question ?? 'current')}
          data-testid="studio-chat-bubble"
          initial={{ y: 12, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 12, opacity: 0, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 460, damping: 30 }}
          className={BUBBLE}
        >
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {busy ? (
            typed ? (
              <div className="max-h-48 min-w-0 overflow-y-auto">
                <MarkdownRenderer content={typed} className="athena-chat-md" />
              </div>
            ) : (
              <Working autonomous={autonomous} name={name} />
            )
          ) : (
            <div className="min-w-0">
              {latest && (
                // Scroll long completed replies instead of overflowing the bubble;
                // the decision (below) stays pinned + visible.
                <div className="max-h-[40vh] overflow-y-auto overscroll-contain">
                  <MarkdownRenderer content={latest.text} className="athena-chat-md" codeBlockActions />
                </div>
              )}
              {decision}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
