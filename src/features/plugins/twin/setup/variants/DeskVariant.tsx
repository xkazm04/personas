/**
 * DeskVariant — Setup as a desk with one sheet on it.
 *
 * Exactly one framed question is in front of the user at a time; everything
 * still open waits in a buffer list on the left, so the surface never argues
 * about where to look. The offered answers are equal-height cards picked with
 * a digit key, and the verdict leaves the desk in the direction it means:
 * accepted rises off the top, skipped slides away.
 *
 * Keyboard scope: the handler lives on the desk element, not on `window`, and
 * returns immediately when the event came from a text field — so the composer
 * still takes plain typing including the very keys the desk binds.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { twinStatusEntry } from '../../shared/twinStatus';
import type { SetupProposal, SetupVariantProps } from '../setupContract';
import { SetupProposalRow } from '../SetupProposalRow';

type Verdict = 'accepted' | 'skipped' | null;

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

export default function DeskVariant({ session, voice }: SetupVariantProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  const [picked, setPicked] = useState(0);
  const [draft, setDraft] = useState('');
  const [verdict, setVerdict] = useState<Verdict>(null);
  const deskRef = useRef<HTMLDivElement>(null);

  const cards = session.suggestions.slice(0, 3);
  const open = session.checklist.filter((item) => item.status !== 'set');

  useEffect(() => { setPicked(0); }, [session.question]);
  useEffect(() => { deskRef.current?.focus(); }, []);

  const submit = (text: string, next: Exclude<Verdict, null>) => {
    if (!text.trim()) return;
    setVerdict(next);
    setDraft('');
    void session.answer(text.trim()).catch(toastCatch('features/plugins/twin/setup/variants/DeskVariant:answer'));
  };

  const skip = () => {
    setVerdict('skipped');
    void session.skip().catch(toastCatch('features/plugins/twin/setup/variants/DeskVariant:skip'));
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

  const onProposalAccept = async (p: SetupProposal) => {
    try { await session.accept(p); } catch (err) { toastCatch('features/plugins/twin/setup/variants/DeskVariant:accept')(err); }
  };

  return (
    <div
      ref={deskRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="setup-desk"
      className="flex-1 min-h-0 flex outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
    >
      {/* Buffer — what is still open. */}
      <aside className="hidden lg:flex flex-col w-56 flex-shrink-0 border-r border-primary/10 bg-secondary/15 py-4">
        <p className="px-4 pb-2 typo-caption uppercase tracking-[0.18em]">{ts.desk.buffer}</p>
        {open.map((item) => {
          const entry = twinStatusEntry(item.status);
          const active = item.id === session.focus;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => session.focusOn(item.id)}
              data-testid={`setup-desk-buffer-${item.id}`}
              className={`flex items-center gap-2 px-4 py-2 text-left transition-colors ${active ? 'bg-secondary/60' : 'hover:bg-secondary/40'}`}
            >
              <span aria-hidden className={`w-1.5 h-4 rounded-full ${active ? 'bg-primary' : entry.dot}`} />
              <span className="min-w-0 flex-1">
                <span className="block typo-caption font-medium text-foreground truncate">{ts.checklist[item.labelKey]}</span>
                <span className={`block typo-caption tabular-nums truncate ${entry.text}`}>{item.detail}</span>
              </span>
            </button>
          );
        })}
        {open.length === 0 && <p className="px-4 typo-caption text-status-success">{ts.desk.bufferClear}</p>}
      </aside>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
          <div className="max-w-[900px] mx-auto">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={session.question ?? 'idle'}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={EXIT[verdict ?? 'none']}
                transition={{ duration: 0.24, ease: 'easeOut' }}
                onAnimationComplete={() => setVerdict(null)}
              >
                <p className="typo-caption uppercase tracking-[0.2em] text-primary/70">{ts.checklist[session.focus]}</p>
                <h2 className="mt-1 typo-heading text-foreground" data-testid="setup-desk-question">
                  {session.question ?? ts.desk.noQuestion}
                </h2>

                <div className="mt-5 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(cards.length, 1)}, minmax(0, 1fr))` }}>
                  {cards.map((card, i) => (
                    <button
                      key={card.text}
                      type="button"
                      onClick={() => setPicked(i)}
                      onDoubleClick={() => submit(card.text, 'accepted')}
                      data-testid={`setup-desk-card-${i + 1}`}
                      className={`h-full flex flex-col gap-2 p-3 rounded-card border text-left transition-all ${
                        i === picked
                          ? 'border-primary/45 bg-primary/10 shadow-elevation-2'
                          : 'border-primary/15 bg-card/50 hover:border-primary/30'
                      }`}
                    >
                      <span className="typo-caption tabular-nums">{i + 1}</span>
                      <span className="typo-body text-foreground leading-relaxed">{card.text}</span>
                      <span className="mt-auto typo-caption">{card.reason}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>

            {session.proposals.length > 0 && (
              <div className="mt-5 space-y-3">
                {session.proposals.map((p) => (
                  <SetupProposalRow
                    key={p.id}
                    proposal={p}
                    onAccept={onProposalAccept}
                    onEdit={(x) => setDraft(x.value)}
                    onDismiss={session.dismiss}
                  />
                ))}
              </div>
            )}

            <div className="mt-5">
              <ChatInputBar
                value={voice.listening && voice.interim ? voice.interim : draft}
                onChange={setDraft}
                onSubmit={() => submit(draft, 'accepted')}
                placeholder={ts.desk.composerPlaceholder}
                sendLabel={ts.conversation.send}
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
