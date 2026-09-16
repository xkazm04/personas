/**
 * OrbitVariant — Setup as a place rather than as a list.
 *
 * The twin's sigil holds the centre and the four slots orbit it, so the shape
 * of the work is visible before a word is read. One large question sits in the
 * middle with its answers as chips around it; a slot's measured fact is the
 * only other text on the surface.
 *
 * This is the variant that shows hands-free voice as POSTURE: the centre wears
 * a ring driven by `voice.listening` and by how much interim transcript has
 * arrived, so it moves because speech is arriving and rests when speech stops.
 * Interim text is shown so the user sees what was heard; only a FINAL
 * transcript ever answers.
 *
 * Motion law: entrance and transition only, never a loop — a perpetual
 * animation claims work is happening when nothing is. `useReducedMotion` (OS
 * media query OR the in-app toggle) degrades all of it to the static layout.
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { hubSlotForFocus } from '../../shared/twinStatus';
import type { SetupFocus, SetupProposal, SetupVariantProps } from '../setupContract';
import { SetupProposalRow } from '../SetupProposalRow';
import { OrbitNode } from './OrbitNode';

/** Where each slot sits on the ring. Diagonals, so the centre band stays free. */
const ANGLE: Record<SetupFocus, number> = { identity: -140, tone: -40, channels: 40, memories: 140 };
const RX = 40;
const RY = 31;

/** Ring point for a slot, in viewBox units and as percentages of the stage. */
function point(focus: SetupFocus) {
  const rad = ((ANGLE[focus] ?? 0) * Math.PI) / 180;
  const x = 50 + RX * Math.cos(rad);
  const y = 50 + RY * Math.sin(rad);
  return { x, y, placement: { left: `${x}%`, top: `${y}%` } };
}

export default function OrbitVariant({ session, voice, onOpenHub }: SetupVariantProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState('');

  const chips = useMemo(() => session.suggestions.slice(0, 4), [session.suggestions]);
  const nodes = useMemo(
    () => session.checklist.map((item) => ({ item, ...point(item.id) })),
    [session.checklist],
  );

  // Interim speech rides the composer as a preview, exactly as the other
  // variants do: visible, editable, and never submitted on its own.
  const composerValue = voice.listening && voice.interim ? voice.interim : draft;
  // Rest when idle, open while listening, widening with what has been heard.
  const ringScale = voice.listening ? 1 + Math.min(voice.interim.length, 80) / 260 : 1;

  const send = () => {
    const text = composerValue.trim();
    if (!text) return;
    setDraft('');
    void session.answer(text).catch(toastCatch('features/plugins/twin/setup/variants/OrbitVariant:answer'));
  };

  const onAccept = async (p: SetupProposal) => {
    try {
      await session.accept(p);
    } catch (err) {
      toastCatch('features/plugins/twin/setup/variants/OrbitVariant:accept')(err);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-4">
        <div className="mx-auto max-w-[760px]">
          <div className="relative w-full h-[360px] md:h-[420px]" data-testid="setup-orbit">
            {/* The ring, drawn once on entrance. Cheap: one ellipse, four spokes. */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden
              className="absolute inset-0 w-full h-full text-primary">
              {nodes.map(({ item, x, y }) => (
                <line key={item.id} x1="50" y1="50" x2={x} y2={y} stroke="currentColor" strokeWidth="1"
                  vectorEffect="non-scaling-stroke" opacity={0.14} />
              ))}
              <motion.ellipse cx="50" cy="50" rx={RX} ry={RY} fill="none" stroke="currentColor" strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                initial={reduced ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.22 }}
                transition={{ duration: reduced ? 0 : 0.9, ease: 'easeOut' }} />
            </svg>

            {nodes.map(({ item, placement }, i) => (
              <OrbitNode key={item.id} item={item} placement={placement} index={i} reduced={reduced}
                active={item.id === session.focus} onFocus={session.focusOn}
                hubSlot={hubSlotForFocus(item.id) ?? undefined} onOpenHub={onOpenHub} />
            ))}

            {/* The centre: sigil, listening posture, the one question, the chips. */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[46%] max-w-[380px] flex flex-col items-center gap-2.5 text-center">
              <div className="relative flex items-center justify-center">
                {voice.handsFree && (
                  <motion.span
                    aria-hidden
                    data-testid="setup-orbit-voice-ring"
                    className={`absolute w-[74px] h-[74px] rounded-full border-2 ${
                      voice.listening ? 'border-status-error/50' : 'border-primary/25'
                    }`}
                    animate={{ scale: ringScale, opacity: voice.listening ? 0.9 : 0.4 }}
                    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 170, damping: 18 }}
                  />
                )}
                <span className="relative w-16 h-16 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shadow-elevation-2">
                  <Sparkles className="w-6 h-6 text-primary" aria-hidden />
                </span>
              </div>

              {voice.handsFree && voice.listening && (
                <span className="sr-only" role="status">{ts.orbit.listening}</span>
              )}
              {voice.interim && (
                <p className="typo-caption line-clamp-2 max-w-full" data-testid="setup-orbit-interim">
                  {voice.interim}
                </p>
              )}

              {session.busy ? (
                <>
                  <div aria-hidden className="h-6 w-4/5 rounded-card bg-secondary/50 animate-pulse" />
                  <span className="sr-only" role="status">{ts.conversation.thinking}</span>
                </>
              ) : (
                <motion.h2 key={session.question ?? 'idle'} className="typo-title-lg text-foreground"
                  data-testid="setup-orbit-question"
                  initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduced ? 0 : 0.28, ease: 'easeOut' }}>
                  {session.question ?? ts.orbit.allSet}
                </motion.h2>
              )}

              {!session.busy && chips.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5" data-testid="setup-orbit-suggestions">
                  {chips.map((s) => (
                    <Tooltip key={s.text} content={s.reason}>
                      <button type="button" onClick={() => setDraft(s.text)} data-testid="setup-orbit-chip"
                        className="px-2.5 py-1 rounded-full border border-primary/20 bg-secondary/40 typo-caption text-foreground transition-colors hover:bg-secondary/70 hover:border-primary/40">
                        {s.text}
                      </button>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
          </div>

          {session.proposals.length > 0 && (
            <div className="mt-2 space-y-3" data-testid="setup-orbit-proposals">
              {session.proposals.map((p) => (
                <SetupProposalRow key={p.id} proposal={p} onAccept={onAccept}
                  onEdit={(x) => setDraft(x.value)} onDismiss={session.dismiss} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-primary/10 bg-card/40 px-4 md:px-6 xl:px-8 py-3">
        <div className="mx-auto max-w-[760px] flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ChatInputBar
              value={composerValue} onChange={setDraft} onSubmit={send}
              placeholder={ts.conversation.placeholder} sendLabel={ts.conversation.send}
              sendTestId="setup-orbit-send" inputTestId="setup-orbit-composer"
              voice={{
                supported: voice.supported, listening: voice.listening,
                onToggle: voice.listening ? voice.stop : voice.start,
                startLabel: ts.voice.dictate, listeningLabel: ts.voice.stop,
              }}
            />
          </div>
          <Button variant="ghost" size="sm" data-testid="setup-orbit-skip"
            onClick={() => void session.skip().catch(toastCatch('features/plugins/twin/setup/variants/OrbitVariant:skip'))}>
            {ts.orbit.skip}
          </Button>
        </div>
      </div>
    </div>
  );
}
