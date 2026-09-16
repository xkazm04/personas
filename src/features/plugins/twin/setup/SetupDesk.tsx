/**
 * SetupDesk — Setup as a desk with one sheet on it, and a thread the user can
 * follow.
 *
 * Exactly one question is in front of the user at a time; everything still open
 * waits in a buffer on the left. The question is not a bare prompt: it is the
 * GUIDE SPEAKING (`DeskTurn`), and above it a compact trail (`DeskTrail`) shows
 * the last exchanges that led here, with everything older folded into one row.
 * On the first turn of a session the guide opens the conversation by naming
 * what it will walk through.
 *
 * The offered answers are equal-height cards picked with a digit key, the typed
 * values the guide proposes are actionable cards under the turn, and the
 * verdict leaves the desk in the direction it means: accepted rises off the
 * top, skipped slides away.
 *
 * Keyboard scope: the handler lives on the desk element, not on `window`, and
 * returns immediately when the event came from a text field — so the composer
 * still takes plain typing including the very keys the desk binds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { SetupDeskProps } from './setupContract';
import { SetupProposalRow } from './SetupProposalRow';
import { DeskBuffer } from './desk/DeskBuffer';
import { DeskTrail } from './desk/DeskTrail';
import { DeskTurn } from './desk/DeskTurn';
import { deriveDeskTrail } from './desk/trailModel';
import { useDeskProposals } from './desk/useDeskProposals';

type Verdict = 'accepted' | 'skipped' | null;

/**
 * The measure the PROSE on the desk keeps — the trail, the proposal rows and
 * the composer. The turn itself is deliberately not held to it: its answer
 * cards are a grid, and a grid is not a line of text.
 */
const READING_MEASURE = 'max-w-[1100px]';

const EXIT: Record<'accepted' | 'skipped' | 'none', { opacity: number; y?: number; x?: number }> = {
  accepted: { opacity: 0, y: -28 },
  skipped: { opacity: 0, x: 48 },
  none: { opacity: 0 },
};

const isTextTarget = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable === true;
};

export function SetupDesk({ session, voice, onOpenHub }: SetupDeskProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.setup;
  const [picked, setPicked] = useState(0);
  const [draft, setDraft] = useState('');
  const [verdict, setVerdict] = useState<Verdict>(null);
  const deskRef = useRef<HTMLDivElement>(null);

  const cards = session.suggestions.slice(0, 3);
  const open = session.checklist.filter((item) => item.status !== 'set');
  const trail = useMemo(
    () => deriveDeskTrail(session.history, session.question),
    [session.history, session.question],
  );

  // The opening line exists only where it is true: the first turn of a session,
  // naming the slots that are actually still open.
  const greeting =
    trail.isOpening && open.length > 0
      ? tx(ts.desk.greeting, { items: open.map((item) => ts.checklist[item.labelKey]).join(', ') })
      : null;

  const intoComposer = useCallback((value: string) => setDraft(value), []);
  const proposals = useDeskProposals(session, intoComposer);

  useEffect(() => { setPicked(0); }, [session.question]);
  useEffect(() => { deskRef.current?.focus(); }, []);

  const submit = (text: string, next: Exclude<Verdict, null>) => {
    if (!text.trim()) return;
    setVerdict(next);
    setDraft('');
    void session.answer(text.trim()).catch(toastCatch('features/plugins/twin/setup/SetupDesk:answer'));
  };

  const skip = () => {
    setVerdict('skipped');
    void session.skip().catch(toastCatch('features/plugins/twin/setup/SetupDesk:skip'));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTextTarget(e.target)) return;
    const digit = Number(e.key);
    if (digit >= 1 && digit <= cards.length) { setPicked(digit - 1); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { setPicked((p) => Math.min(p + 1, cards.length - 1)); e.preventDefault(); return; }
    if (e.key === 'ArrowLeft') { setPicked((p) => Math.max(p - 1, 0)); e.preventDefault(); return; }
    if (e.key === 'Enter' && cards[picked]) { submit(cards[picked].text, 'accepted'); e.preventDefault(); return; }
    if (e.key.toLowerCase() === 'e' && cards[picked]) { setDraft(cards[picked].text); e.preventDefault(); return; }
    if (e.key.toLowerCase() === 's') { skip(); e.preventDefault(); }
  };

  return (
    <div
      ref={deskRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="setup-desk"
      className="flex-1 min-h-0 flex outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
    >
      <DeskBuffer items={open} focus={session.focus} onFocus={session.focusOn} onOpenHub={onOpenHub} />

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
          {/* No width cap on the turn. The 900px column this used to sit in was
              a reading measure applied to the wrong thing: the question is one
              line and the ANSWER CARDS are what needed the room. The trail and
              the composer keep a measure of their own, because those two are
              prose and a 2000px line of prose is unreadable. */}
          <div className="w-full">
            <div className={READING_MEASURE}>
              <DeskTrail trail={trail} />
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={session.question ?? 'idle'}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={EXIT[verdict ?? 'none']}
                transition={{ duration: 0.24, ease: 'easeOut' }}
                onAnimationComplete={() => setVerdict(null)}
              >
                <DeskTurn
                  focusLabel={ts.checklist[session.focus]}
                  greeting={greeting}
                  question={session.question ?? ts.desk.noQuestion}
                  cards={cards}
                  picked={picked}
                  busy={session.busy}
                  onPick={setPicked}
                  onCommit={(text) => submit(text, 'accepted')}
                />
              </motion.div>
            </AnimatePresence>

            {proposals.record.length > 0 && (
              <div className={`mt-5 space-y-3 md:pl-11 ${READING_MEASURE}`}>
                {proposals.record.map((p) => (
                  <SetupProposalRow
                    key={p.id}
                    proposal={p}
                    resolution={proposals.resolved[p.id]}
                    onAccept={proposals.onAccept}
                    onEdit={proposals.onEdit}
                    onDismiss={proposals.onDismiss}
                  />
                ))}
              </div>
            )}

            <div className={`mt-5 md:pl-11 ${READING_MEASURE}`}>
              <ChatInputBar
                value={voice.listening && voice.interim ? voice.interim : draft}
                onChange={setDraft}
                onSubmit={() => submit(draft, 'accepted')}
                placeholder={ts.desk.composerPlaceholder}
                sendLabel={ts.desk.send}
                inputTestId="setup-desk-composer"
                voice={{
                  supported: voice.supported,
                  listening: voice.listening,
                  onToggle: voice.listening ? voice.stop : voice.start,
                  startLabel: ts.voice.dictate,
                  listeningLabel: ts.voice.stop,
                }}
              />
            </div>
          </div>
        </div>

        {/* The legend is always visible: a key binding nobody can see is not a binding. */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-8 py-2 border-t border-primary/10 bg-card/40 typo-caption">
          <span>{ts.desk.legendPick}</span>
          <span>{ts.desk.legendAccept}</span>
          <span>{ts.desk.legendEdit}</span>
          <span>{ts.desk.legendSkip}</span>
        </div>
      </div>
    </div>
  );
}

export default SetupDesk;
