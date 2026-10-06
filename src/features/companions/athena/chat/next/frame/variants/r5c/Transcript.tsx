/**
 * Folio · the conversation, set like a play: the speaker's name in small caps
 * in the left margin, the speech on a book measure beside it. Her words are
 * roman at reading size; yours are italic and travel in from the composer
 * (the ask wears the outgoing line's layout id, `r5c-line-<n>`). What the
 * machine did in a turn is a marginal GLOSS under the speaker's name, folded
 * to a count and opened in place.
 */

import { memo, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronUp } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { stripModelDirectives } from '../../../../../athenaLabels';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { AthenaChatTurnActions } from '../../../../AthenaChatTurnActions';
import { AssistantProse } from '../../../../refs/AssistantProse';
import { buildTurns, type Turn } from '../../../exchange';
import { FOLIO_COPY as C } from './copy';
import { GlossNotes, GlossToggle, SetAside } from './Gloss';

const PAGE = 12;

const SPEAKER: Record<Turn['trigger'], string> = {
  user: C.her,
  autonomous: C.sheOnHerOwn,
  proactive: C.sheReachedOut,
  fleet: C.fleetSpoke,
};

interface Placed {
  turn: Turn;
  key: string;
  /** 1-based position of this turn's ask among all of your lines. */
  line: number | null;
}

export const Transcript = memo(function Transcript({ engine, onOpenWaiting }: { engine: AthenaChatEngine; onOpenWaiting: () => void }) {
  const placed = useMemo<Placed[]>(() => {
    let n = 0;
    // Keyed by your line's ordinal, not the message id: the optimistic ask is
    // re-filed under its canonical id a moment later and must not remount.
    return buildTurns(engine.messages).map((turn) => {
      const line = turn.ask ? ++n : null;
      return { turn, line, key: line ? `line-${line}` : `turn-${turn.id}` };
    });
  }, [engine.messages]);
  const [shown, setShown] = useState(PAGE);
  const hidden = Math.max(0, placed.length - shown);
  const visible = hidden > 0 ? placed.slice(hidden) : placed;
  const lastKey = placed[placed.length - 1]?.key;

  return (
    <div className="r5c-transcript">
      {hidden > 0 && (
        <Button variant="ghost" size="sm" className="r5c-earlier" onClick={() => setShown((s) => s + PAGE)} icon={<ChevronUp className="w-4 h-4" aria-hidden />}>
          {C.earlier(hidden)}
        </Button>
      )}
      <AnimatePresence initial={false}>
        {visible.map((p) => (
          <TurnBlock
            key={p.key}
            placed={p}
            last={p.key === lastKey}
            streaming={engine.streaming}
            interactive={engine.initialized}
            onSend={engine.send}
            onOpenWaiting={onOpenWaiting}
          />
        ))}
      </AnimatePresence>
    </div>
  );
});

function TurnBlock({
  placed,
  last,
  streaming,
  interactive,
  onSend,
  onOpenWaiting,
}: {
  placed: Placed;
  last: boolean;
  streaming: boolean;
  interactive: boolean;
  onSend: (text: string) => void;
  onOpenWaiting: () => void;
}) {
  const { shouldAnimate } = useMotion();
  const { turn, line } = placed;
  const [glossOpen, setGlossOpen] = useState(false);
  const lastReply = turn.replies[turn.replies.length - 1];
  const recall = useAthenaStore((s) => (lastReply ? s.recallByEpisodeId[lastReply.id] : undefined));
  const memories = recall
    ? recall.doctrine.length + recall.facts.length + recall.procedurals.length + recall.goals.length + recall.backlog.length
    : 0;
  const glosses = turn.machine.length + turn.asides.length;
  if (!turn.ask && turn.replies.length === 0 && glosses === 0) return null;

  return (
    <motion.section
      className="r5c-turn"
      data-testid="companion-r5c-turn"
      // Your line arrives by flight; only her side fades in.
      initial={shouldAnimate && !turn.ask ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {turn.ask && line !== null && (
        <div className="r5c-speech you">
          <p className="r5c-speaker">
            <span className="r5c-sc typo-label">{C.you}</span>
            <RelativeTime timestamp={turn.createdAt} className="typo-caption r5c-when" />
          </p>
          <motion.p layoutId={`r5c-line-${line}`} layout="position" className="typo-body-lg italic text-foreground r5c-words">
            {turn.ask.content}
          </motion.p>
        </div>
      )}
      {(turn.replies.length > 0 || glosses > 0) && (
        <div className="r5c-speech her">
          <div className="r5c-speaker">
            <span className="r5c-sc typo-label text-primary">{SPEAKER[turn.trigger]}</span>
            {!turn.ask && <RelativeTime timestamp={turn.createdAt} className="typo-caption r5c-when" />}
            {glosses > 0 && <GlossToggle count={glosses} open={glossOpen} onToggle={() => setGlossOpen((o) => !o)} />}
            {memories > 0 && <span className="typo-caption italic r5c-when">{C.memories(memories)}</span>}
          </div>
          <div className="r5c-words min-w-0">
            {turn.replies.map((r) => (
              <div key={r.id} className="typo-body-lg text-foreground r5c-prose">
                <AssistantProse content={stripModelDirectives(r.content)} codeBlockActions />
              </div>
            ))}
            {glossOpen && <GlossNotes turn={turn} />}
            <SetAside reply={lastReply ?? null} onOpen={onOpenWaiting} />
            {last && lastReply && !streaming && (
              <div className="r5c-actions">
                <AthenaChatTurnActions
                  content={lastReply.content}
                  priorUserMessage={turn.ask?.content ?? ''}
                  onSend={onSend}
                  disabled={!interactive || streaming}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </motion.section>
  );
}
