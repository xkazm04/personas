/**
 * DeckLayer — variant A's nested layer: ONE decision at a time, at full size.
 *
 * A numbered queue runs across the top (the same order as the roster dots),
 * the focused card fills the space the conversation had, and the composer
 * below stays live, replying "about" the card in focus. Keys: ←/→ or J/K move,
 * 1-9 jump, Esc returns to the conversation.
 */

import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { KIND_VAR, TONE_DOT } from '../tones';
import { NEXT_COPY as C } from '../nextCopy';
import { WorkItemBody } from '../WorkItemBody';
import type { ProjectLane, WorkItem } from '../useWorkforce';

export function DeckLayer({
  items,
  focusId,
  lane,
  onFocus,
  onBack,
  onSend,
}: {
  items: WorkItem[];
  focusId: string | null;
  lane: ProjectLane | null;
  onFocus: (id: string) => void;
  onBack: () => void;
  onSend: (text: string) => void;
}) {
  const index = Math.max(0, items.findIndex((i) => i.id === focusId));
  const item = items[index] ?? null;

  useAppKeyboard(
    (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return false;
      const go = (i: number) => items[i] && onFocus(items[i]!.id);
      if (e.key === 'ArrowRight' || e.key === 'j') go(Math.min(items.length - 1, index + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'k') go(Math.max(0, index - 1));
      else if (/^[1-9]$/.test(e.key)) go(Number(e.key) - 1);
      else return false;
      e.preventDefault();
      return true;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-3 px-8 pt-5 pb-3 border-b border-foreground/10">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-interactive px-2 py-1 typo-body text-foreground/80 hover:bg-foreground/[0.06] focus-ring"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          {C.backToChat}
        </button>
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onFocus(it.id)}
              className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-1 typo-caption focus-ring transition-colors ${
                i === index ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-foreground/12 text-foreground/75 hover:bg-foreground/[0.05]'
              }`}
            >
              <span className="font-mono text-foreground/60">{i + 1}</span>
              <span className="w-2 h-2 rounded-full" style={{ background: KIND_VAR[it.kind] }} aria-hidden />
              {C.kind[it.kind]}
            </button>
          ))}
        </div>
      </div>

      {lane && (
        <div className="flex items-center gap-4 px-8 py-3 border-b border-foreground/10">
          <span className="typo-label uppercase tracking-wider text-muted">{C.processes}</span>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {lane.bullets.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-2 typo-body text-foreground/85">
                <span className={`w-2.5 h-2.5 rounded-full ${TONE_DOT[b.tone]}`} aria-hidden />
                {b.label}
                <span className="typo-caption text-muted">{C.tone[b.tone]}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-8 py-8">
        {!item ? (
          <div className="h-full grid place-items-center text-center">
            <div>
              <p className="typo-section-title text-foreground">{C.nothingWaiting}</p>
              <p className="typo-body text-foreground/70 mt-1">{C.nothingWaitingSub}</p>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.article
              key={item.id}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }}
              className="mx-auto max-w-[88ch]"
            >
              <p className="typo-label uppercase tracking-wider" style={{ color: KIND_VAR[item.kind] }}>
                {C.kind[item.kind]}
                {item.project ? ` · ${item.project}` : ''} · {C.of(index + 1, items.length)}
              </p>
              <h2 className="typo-heading-lg text-foreground mt-2 mb-6 leading-snug">{item.title}</h2>
              <div
                className="rounded-card border-l-4 bg-secondary/30 p-5 shadow-elevation-2"
                style={{ borderLeftColor: KIND_VAR[item.kind] }}
              >
                <WorkItemBody item={item} onSend={onSend} />
              </div>
              <div className="mt-6 flex items-center justify-between typo-caption text-muted">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onFocus(items[index - 1]!.id)}
                  className="inline-flex items-center gap-1 disabled:is-disabled hover:text-foreground focus-ring rounded-interactive px-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" aria-hidden /> K
                </button>
                <button
                  type="button"
                  disabled={index >= items.length - 1}
                  onClick={() => onFocus(items[index + 1]!.id)}
                  className="inline-flex items-center gap-1 disabled:is-disabled hover:text-foreground focus-ring rounded-interactive px-1"
                >
                  J <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                </button>
              </div>
            </motion.article>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
