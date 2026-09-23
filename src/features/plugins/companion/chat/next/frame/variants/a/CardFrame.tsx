/**
 * CardFrame — the played card of Halo · Hand, face up at the centre.
 *
 * Built like a collectible card: a layered gradient border (the kind colour
 * braided with gold), an inner bevel, a textured field tinted by the kind,
 * two corner gems (top-left: the kind glyph; top-right: the lane's crest), the
 * title on a notched name banner, and the real product surface
 * (`WorkItemBody`, with its own approve/reject/answer verbs) as the text box.
 * The frame never re-implements a verb.
 */

import { motion } from 'framer-motion';
import { Undo2 } from 'lucide-react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { KIND_VAR } from '../../../tones';
import { NEXT_COPY as N } from '../../../nextCopy';
import { WorkItemBody } from '../../../WorkItemBody';
import type { WorkItem } from '../../../useWorkforce';
import { HAND_COPY as C } from './copy';
import { Crest, GOLD, GOLD_DEEP, GOLD_SOFT, KIND_GLYPH } from './handTokens';

const BANNER_CLIP = 'polygon(0 0, 100% 0, 97% 50%, 100% 100%, 0 100%, 3% 50%)';

export function CardFrame({
  item,
  round,
  total,
  onBackToHand,
  onSend,
}: {
  item: WorkItem;
  round: number;
  total: number;
  onBackToHand: () => void;
  onSend: (text: string) => void;
}) {
  const kind = KIND_VAR[item.kind];
  const Glyph = KIND_GLYPH[item.kind];
  const { shouldAnimate } = useMotion();
  return (
    <div
      className="relative h-full rounded-[20px] p-[3px] shadow-elevation-4"
      style={{
        background: `linear-gradient(155deg, ${GOLD} 0%, ${kind} 22%, ${GOLD_DEEP} 48%, ${kind} 74%, ${GOLD} 100%)`,
        boxShadow: `0 24px 60px -20px ${kind}, 0 0 0 1px color-mix(in srgb, var(--background) 60%, transparent)`,
      }}
    >
      <div
        className="relative h-full flex flex-col rounded-[17px] overflow-hidden"
        style={{
          background:
            'repeating-linear-gradient(0deg, color-mix(in srgb, var(--foreground) 2.5%, transparent) 0 1px, transparent 1px 4px),' +
            `radial-gradient(ellipse at 50% -10%, color-mix(in srgb, ${kind} 26%, var(--background)), var(--background) 62%)`,
          boxShadow: `inset 0 0 0 1px ${GOLD_SOFT}, inset 0 2px 0 color-mix(in srgb, var(--foreground) 10%, transparent), inset 0 -10px 24px -12px color-mix(in srgb, var(--background) 90%, transparent)`,
        }}
      >
        {/* One idle shimmer across the face when the card lands; never loops. */}
        {shouldAnimate && (
          <motion.span
            className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12"
            style={{ background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${GOLD} 14%, transparent), transparent)` }}
            initial={{ left: '-40%' }}
            animate={{ left: '120%' }}
            transition={{ duration: 1.1, delay: 0.55, ease: 'easeInOut' }}
            aria-hidden
          />
        )}

        <div className="relative shrink-0 flex items-start justify-between gap-3 px-4 pt-4">
          <Tooltip content={N.kind[item.kind]} placement="bottom">
            <span
              className="grid place-items-center w-10 h-10 rotate-45 rounded-[8px] shrink-0"
              style={{
                background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
                padding: 2,
              }}
            >
              <span
                className="grid place-items-center w-full h-full rounded-[6px]"
                style={{ background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${kind} 70%, var(--foreground)), color-mix(in srgb, ${kind} 55%, var(--background)))` }}
              >
                <Glyph className="-rotate-45 w-4 h-4 text-background" />
              </span>
            </span>
          </Tooltip>
          <div className="flex-1 min-w-0 text-center pt-1">
            <p className="typo-label uppercase tracking-wider" style={{ color: kind }}>
              {N.kind[item.kind]}
              {item.project ? ` · ${item.project}` : ''}
            </p>
            <p className="typo-caption text-muted mt-0.5">{C.roundOf(round, total)}</p>
          </div>
          <Tooltip content={item.project ?? C.athenaCrest} placement="bottom">
            <span className="block">
              <Crest athena={!item.project} label={item.project ?? C.athenaCrest} size={40} />
            </span>
          </Tooltip>
        </div>

        <div className="relative shrink-0 mx-5 mt-3" style={{ clipPath: BANNER_CLIP, background: `linear-gradient(90deg, ${GOLD_DEEP}, ${GOLD}, ${GOLD_DEEP})`, padding: 1.5 }}>
          <h2
            className="typo-section-title text-foreground text-center leading-snug px-8 py-2.5 line-clamp-3"
            style={{ clipPath: BANNER_CLIP, background: `linear-gradient(180deg, color-mix(in srgb, ${kind} 18%, var(--secondary)), var(--background))` }}
          >
            {item.title}
          </h2>
        </div>

        <div
          className="relative flex-1 min-h-0 overflow-y-auto scrollbar-thin mx-5 mt-4 rounded-card p-4 typo-body"
          style={{
            background: 'color-mix(in srgb, var(--background) 82%, transparent)',
            boxShadow: `inset 0 0 0 1px ${GOLD_SOFT}, inset 0 6px 14px -10px color-mix(in srgb, var(--background) 100%, transparent)`,
          }}
        >
          <WorkItemBody item={item} onSend={onSend} />
        </div>

        <div className="relative shrink-0 flex items-center justify-between gap-3 px-5 py-3">
          <button
            type="button"
            onClick={onBackToHand}
            className="inline-flex items-center gap-1.5 rounded-interactive px-2 py-1 typo-body text-foreground/85 hover:bg-foreground/[0.06] hover:text-foreground focus-ring"
          >
            <Undo2 className="w-4 h-4" aria-hidden />
            {C.backToHand}
          </button>
          <span className="typo-caption text-muted flex items-center gap-3">
            <span><Kbd>1-9</Kbd> {C.keys.pick}</span>
            <span><Kbd>Enter</Kbd> {C.keys.play}</span>
            <span><Kbd>Esc</Kbd> {C.keys.back}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-[4px] border border-foreground/15 bg-foreground/[0.05] px-1.5 typo-caption text-foreground">
      {children}
    </kbd>
  );
}
