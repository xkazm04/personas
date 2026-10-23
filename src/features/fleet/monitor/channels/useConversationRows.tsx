import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { Engraved } from '../grid/prototype/entry-e/parts';
import { DeliberationBand } from './DeliberationBand';
import { ProposalBand } from './ProposalBand';
import { RunBand } from './RunBand';
import { TalkLine } from './TalkLine';
import { QueuedPromptRow } from './QueuedPromptRow';
import { dayLabel, type ConversationRow } from './conversationModel';
import type { useConversation } from './useConversation';

/**
 * The row renderer of the Conversations timeline: one switch from a
 * `ConversationRow` to the card that draws it, plus the expanded set the band
 * cards fold open with.
 *
 * C2/C3: `renderRow` closes over STABLE references only (the memoized conv's
 * fields, keyed callbacks, state setters). It previously closed over a fresh
 * `conv` literal and minted per-row closures, so every poll re-rendered every
 * visible row; now the memo'd cards bail unless their own row changed.
 */
export function useConversationRows(
  conv: ReturnType<typeof useConversation>,
  onOpen: (item: TeamChannelItem) => void,
  onFocusDeliberation: (deliberationId: string) => void,
  /** The deliberation whose controls the rail is showing (its Drive reads pressed). */
  drivingId: string | null = null,
) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (key: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  const dayWords = useMemo(
    () => ({ today: t.monitor.conv_day_today, yesterday: t.monitor.conv_day_yesterday }),
    [t],
  );

  const { delibIndex, confirmProposal, dropProposal, retryPrompt, dropPrompt } = conv;
  // Keyed, so `ProposalCard`'s memo has stable props to bail on.
  const runProposal = useCallback(
    (p: Parameters<typeof confirmProposal>[0]) => void confirmProposal(p),
    [confirmProposal],
  );

  return useCallback(
    (row: ConversationRow) => {
      switch (row.kind) {
        case 'day':
          return (
            <div className="flex items-center gap-2 py-2">
              <span className="flex-1 h-px bg-border" />
              <Engraved>{dayLabel(row.at, dayWords)}</Engraved>
              <span className="flex-1 h-px bg-border" />
            </div>
          );
        case 'talk':
          return <TalkLine item={row.item} onOpen={onOpen} />;
        case 'assignment':
          return (
            <RunBand
              assignmentId={row.assignmentId}
              items={row.items}
              expanded={expanded.has(row.key)}
              rowKey={row.key}
              onToggle={toggle}
            />
          );
        case 'deliberation':
          return (
            <DeliberationBand
              deliberation={delibIndex.get(row.deliberationId)}
              deliberationId={row.deliberationId}
              items={row.items}
              expanded={expanded.has(row.key)}
              rowKey={row.key}
              onToggle={toggle}
              onFocus={onFocusDeliberation}
              driving={drivingId === row.deliberationId}
            />
          );
        case 'proposal':
          return <ProposalBand proposal={row.proposal} onConfirm={runProposal} onDismiss={dropProposal} />;
        case 'queued':
          return <QueuedPromptRow prompt={row.prompt} onRetry={retryPrompt} onDrop={dropPrompt} />;
      }
    },
    [expanded, toggle, delibIndex, onOpen, onFocusDeliberation, drivingId, runProposal, dropProposal, retryPrompt, dropPrompt, dayWords],
  );
}
