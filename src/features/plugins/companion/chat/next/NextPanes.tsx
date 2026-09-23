/**
 * `TurnPane`: what sits behind one turn: her recall, her plan, the jobs she
 * started, and every machine row as the app's own system notes. The Frame's
 * expanded top piece opens it from a turn's tick strip.
 */

import { useCallback } from 'react';
import type { BrainKind } from '@/api/companion';
import { OperationalThread } from '../../OperationalThread';
import { RecallStrip } from '../../RecallStrip';
import { useCompanionStore } from '../../companionStore';
import { AthenaChatMessageJobs } from '../AthenaChatMessageJobs';
import { AthenaChatMessageRow } from '../AthenaChatMessageRow';
import type { Turn } from './exchange';
import { NEXT_COPY as C } from './nextCopy';

const noop = () => {};

export function PaneTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-5">
      <p className="typo-label uppercase tracking-wider text-primary">{kicker}</p>
      <h2 className="typo-section-title text-foreground mt-1">{title}</h2>
    </div>
  );
}

export function TurnPane({ turn }: { turn: Turn }) {
  const lastReply = turn.replies[turn.replies.length - 1];
  const recall = useCompanionStore((s) => (lastReply ? s.recallByEpisodeId[lastReply.id] : undefined));
  const steps = useCompanionStore((s) => (lastReply ? s.stepsByEpisodeId[lastReply.id] : undefined));
  const jobIds = useCompanionStore((s) => (lastReply ? s.connectorJobIdsByEpisodeId[lastReply.id] : undefined));
  const openInBrain = useCallback((kind: BrainKind, id: string) => {
    useCompanionStore.getState().setBrainView({ open: true, kind, id });
  }, []);
  return (
    <div className="space-y-3 max-w-[96ch]">
      <PaneTitle kicker={C.turnDetail} title={turn.ask?.content.slice(0, 120) ?? C.autonomousTurn} />
      {recall && <RecallStrip preview={recall} onOpenInBrain={openInBrain} />}
      {steps && steps.length > 0 && <OperationalThread steps={steps} />}
      {jobIds && <AthenaChatMessageJobs jobIds={jobIds} />}
      {turn.machine.map((m, i) => (
        <AthenaChatMessageRow
          key={m.id}
          message={{ id: m.id, role: 'system', content: m.content, createdAt: turn.createdAt }}
          index={i}
          compact={false}
          groupStart
          groupEnd
          daySepLabel={null}
          recall={undefined}
          steps={undefined}
          summary={undefined}
          jobIds={[]}
          isLastAssistant={false}
          priorUserMessage=""
          streaming={false}
          interactive={false}
          onOpenInBrain={openInBrain}
          onJumpSummary={noop}
          onSend={noop}
        />
      ))}
    </div>
  );
}
