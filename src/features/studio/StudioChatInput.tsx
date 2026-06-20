import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Send, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { COMPANION_STREAM_EVENT, type CompanionStreamEvent } from '@/api/companion';
import { extractAssistantTextDelta } from '@/features/plugins/companion/extractAssistantText';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { toastCatch } from '@/lib/silentCatch';
import { webbuildSessionSend } from '@/api/webbuild';
import type { BuildPhase } from './studioBuildModel';

// Minimal Studio chat: a send-only input with a single response bubble above it
// that streams Athena's reply LIVE (token-by-token, reusing the companion's
// stream-delta extraction off `companion://stream` filtered to the build
// session), then settles to her full markdown reply. The trailing BUILD_PLAN
// line is hidden mid-stream so raw JSON never flashes.
export default function StudioChatInput({
  projectId,
  projectName,
  onPhases,
  seed,
  onSeedConsumed,
}: {
  projectId: string;
  projectName: string;
  onPhases?: (phases: BuildPhase[]) => void;
  seed?: string | null;
  onSeedConsumed?: () => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [stream, setStream] = useState('');
  const streamRef = useRef('');
  const pulseForwardAck = useCompanionStore((s) => s.pulseForwardAck);
  const pulseMessageReaction = useCompanionStore((s) => s.pulseMessageReaction);

  // Live token stream for THIS project's build session.
  const onStream = useCallback(
    (event: { payload: CompanionStreamEvent }) => {
      const ev = event.payload;
      if (ev.sessionId !== `webbuild:${projectId}`) return;
      if (ev.kind === 'started') {
        streamRef.current = '';
        setStream('');
      } else if (ev.kind === 'cli') {
        const delta = extractAssistantTextDelta(ev.payload);
        if (delta) {
          streamRef.current += delta;
          setStream(streamRef.current);
        }
      }
    },
    [projectId],
  );
  useTauriEvent<CompanionStreamEvent>(COMPANION_STREAM_EVENT, onStream);

  const runTurn = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput('');
      setReply(null);
      streamRef.current = '';
      setStream('');
      setBusy(true);
      pulseForwardAck(); // orb acknowledges the send ("got it")
      try {
        const result = await webbuildSessionSend(projectId, text);
        setReply(result.reply.trim() || 'Done.');
        if (result.phases && result.phases.length > 0) onPhases?.(result.phases);
        pulseMessageReaction(); // orb plays its one-shot reply reaction
      } catch (e) {
        setReply('Something went wrong with that change.');
        toastCatch('build instruction')(e);
      } finally {
        setBusy(false);
      }
    },
    [busy, projectId, onPhases, pulseForwardAck, pulseMessageReaction],
  );
  const send = useCallback(() => void runTurn(input), [runTurn, input]);

  // Auto-send the project's seed vision once (set by the Vision start after the
  // dev server is live), routed through the normal turn so it streams + reacts.
  const seedSentRef = useRef(false);
  useEffect(() => {
    seedSentRef.current = false;
  }, [projectId]);
  useEffect(() => {
    if (seed && !seedSentRef.current && !busy) {
      seedSentRef.current = true;
      onSeedConsumed?.();
      void runTurn(seed);
    }
  }, [seed, busy, runTurn, onSeedConsumed]);

  // Hide the trailing BUILD_PLAN line while it streams (raw JSON never shows).
  const streamDisplay = (stream.split('BUILD_PLAN:')[0] ?? '').trimEnd();
  const showBubble = busy || reply !== null;

  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex w-[min(38rem,calc(100%-7rem))] -translate-x-1/2 flex-col gap-2">
      <AnimatePresence>
        {showBubble && (
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="pointer-events-auto flex max-w-full items-start gap-2 self-start rounded-modal border border-border bg-background/95 px-3 py-2 shadow-elevation-4 backdrop-blur"
          >
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {busy ? (
              streamDisplay ? (
                <div className="max-h-48 min-w-0 overflow-y-auto whitespace-pre-wrap break-words text-md text-foreground/90">
                  {streamDisplay}
                  <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-primary align-middle" />
                </div>
              ) : (
                <span className="flex items-center gap-1.5 text-md text-foreground/80">
                  Athena is working
                  <span className="flex gap-0.5">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:300ms]" />
                  </span>
                </span>
              )
            ) : (
              <div className="min-w-0">
                <MarkdownRenderer content={reply ?? ''} className="athena-chat-md" codeBlockActions />
              </div>
            )}
            {!busy && reply !== null && (
              <button
                type="button"
                onClick={() => setReply(null)}
                aria-label="Dismiss"
                className="ml-1 shrink-0 rounded-interactive p-0.5 text-foreground/40 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/90 py-1.5 pl-4 pr-1.5 shadow-elevation-3 backdrop-blur">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={`Tell Athena what to build in ${projectName}…`}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-md text-foreground outline-none placeholder:text-foreground/45 disabled:opacity-60"
        />
        <Button
          variant="primary"
          size="sm"
          className="shrink-0 rounded-full"
          icon={<Send className="h-4 w-4" />}
          loading={busy}
          disabled={!input.trim() || busy}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
