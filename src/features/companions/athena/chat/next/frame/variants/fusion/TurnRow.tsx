/**
 * Fusion · one turn of the conversation, laid out on the x axis. The meta
 * (who, when) sits in a narrow right-aligned gutter beside the words rather
 * than in a header row above them, so a turn costs no line of its own; the
 * words run on one wide column with a reading measure.
 *
 * Her reply is rendered by Current's own pieces, not re-implemented: the
 * recall strip (`RecallStrip`), her prose with ref links, id net and fold
 * (`AssistantProse`), brain-id chips (`BrainLinksStrip`), her plan
 * (`OperationalThread`), connector jobs (`AthenaChatMessageJobs`), what the
 * turn set aside (`TurnSummaryChip`), and on the newest reply the refine /
 * read-aloud row (`AthenaChatTurnActions`). Machine rows fold into ticks
 * (`MachineFold`).
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { memo, type ReactNode } from 'react';
import type { BrainKind } from '@/api/companion';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { stripModelDirectives } from '../../../../../athenaLabels';
import { useAthenaStore } from '../../../../../athenaStore';
import { BrainLinksStrip } from '../../../../../BrainLinksStrip';
import { OperationalThread } from '../../../../../OperationalThread';
import { RecallStrip } from '../../../../../RecallStrip';
import { TurnSummaryChip } from '../../../../../TurnSummaryChip';
import { AthenaChatMessageJobs } from '../../../../AthenaChatMessageJobs';
import type { TurnSummaryJumpTarget } from '../../../../AthenaChatMessageRow';
import { AthenaChatTurnActions } from '../../../../AthenaChatTurnActions';
import { AssistantProse } from '../../../../refs/AssistantProse';
import type { Turn } from '../../../exchange';
import { NEXT_COPY as C } from '../../../nextCopy';
import { FUSION_COPY as F } from './copy';
import { MachineFold } from './MachineFold';

const NO_JOBS: string[] = [];

/** Her reply this long after the ask gets a time of its own; sooner, the ask's time says it. */
const SLOW_REPLY_MS = 60_000;

/** The gutter: who, and when, on ONE line. */
function Who({ when, sticky = false, children }: { when: string | null; sticky?: boolean; children: ReactNode }) {
  return (
    <span className={`fu-who${sticky ? ' is-sticky' : ''}`}>
      {children}
      {when && (
        <>
          <span className="fu-sep" aria-hidden>
            ·
          </span>
          <RelativeTime timestamp={when} format="elapsed" className="typo-caption fu-when tabular-nums" />
        </>
      )}
    </span>
  );
}

const TRIGGER: Record<Turn['trigger'], string> = {
  user: F.athena,
  autonomous: C.autonomousTurn,
  proactive: C.proactiveTurn,
  fleet: C.fleetTurn,
};

function Reply({
  id,
  content,
  onOpenInBrain,
}: {
  id: string;
  content: string;
  onOpenInBrain: (kind: BrainKind, id: string) => void;
}) {
  const recall = useAthenaStore((s) => s.recallByEpisodeId[id]);
  const steps = useAthenaStore((s) => s.stepsByEpisodeId[id]);
  const jobs = useAthenaStore((s) => s.connectorJobIdsByEpisodeId[id]) ?? NO_JOBS;
  const text = stripModelDirectives(content);
  return (
    <div className="fu-reply">
      {recall && <RecallStrip preview={recall} onOpenInBrain={onOpenInBrain} />}
      <div className="typo-body-lg text-foreground min-w-0">
        <AssistantProse content={text} codeBlockActions />
      </div>
      <BrainLinksStrip content={text} onOpen={onOpenInBrain} variant="inline" />
      {steps && steps.length > 0 && <OperationalThread steps={steps} />}
      <AthenaChatMessageJobs jobIds={jobs} />
    </div>
  );
}

export const TurnRow = memo(function TurnRow({
  turn,
  index,
  isLatest,
  streaming,
  interactive,
  onSend,
  onOpenInBrain,
  onJumpSummary,
}: {
  turn: Turn;
  index: number;
  /** Carries the newest reply: the refine / read-aloud row sits under it. */
  isLatest: boolean;
  streaming: boolean;
  interactive: boolean;
  onSend: (text: string) => void;
  onOpenInBrain: (kind: BrainKind, id: string) => void;
  onJumpSummary: (target: TurnSummaryJumpTarget) => void;
}) {
  const last = turn.replies[turn.replies.length - 1];
  const summary = useAthenaStore((s) => (last ? s.turnSummaryByEpisodeId[last.id] : undefined));
  const said = turn.asides.length > 0 || turn.replies.length > 0 || turn.machine.length > 0;
  if (!turn.ask && !said) return null;
  const replyAt = last?.createdAt ?? turn.createdAt;
  const slow = turn.ask ? Date.parse(replyAt) - Date.parse(turn.ask.createdAt) >= SLOW_REPLY_MS : true;

  return (
    <section className="fu-turn animate-fade-slide-in" data-testid="companion-fusion-turn">
      {turn.ask && (
        <>
          <Who when={turn.ask.createdAt}>
            <span className="typo-label text-accent">{F.you}</span>
          </Who>
          <p className="fu-ask typo-body-lg" data-fusion-ask="">
            {turn.ask.content}
          </p>
        </>
      )}
      {said && (
        <>
          <Who when={slow ? replyAt : null} sticky>
            <span className="fu-who-her">
              <span className="fu-face-sm" aria-hidden />
              <span className={`typo-label ${turn.trigger === 'proactive' ? 'text-brand-purple' : 'text-primary'}`}>
                {TRIGGER[turn.trigger]}
              </span>
            </span>
          </Who>
          <div className="fu-said">
            {turn.asides.map((a, i) => (
              <p key={i} className="fu-aside typo-body">
                {a}
              </p>
            ))}
            {turn.replies.map((r) => (
              <Reply key={r.id} id={r.id} content={r.content} onOpenInBrain={onOpenInBrain} />
            ))}
            <div className="fu-meta">
              <MachineFold rows={turn.machine} index={index} />
              {summary && <TurnSummaryChip summary={summary} onJump={onJumpSummary} />}
              {last && <CopyButton text={stripModelDirectives(last.content)} iconSize="w-3.5 h-3.5" />}
            </div>
            {isLatest && last && !streaming && (
              <div className="fu-actions">
                <AthenaChatTurnActions
                  content={last.content}
                  priorUserMessage={turn.ask?.content ?? ''}
                  onSend={onSend}
                  disabled={!interactive || streaming}
                />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
});
