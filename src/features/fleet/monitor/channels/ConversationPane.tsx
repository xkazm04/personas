import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ConversationComposer } from './ConversationComposer';
import { ConversationGhostRows } from './ConversationGhostRows';
import { VirtualConversation } from './VirtualConversation';
import type { ConversationRow } from './conversationModel';
import type { useConversation } from './useConversation';
import type { StreamTeam } from './types';

/** The team conversation's plate body: the timeline (or its loading and empty
 *  states) over the composer. */
export function ConversationPane({
  team, conv, renderRow,
}: {
  team: StreamTeam | null;
  conv: ReturnType<typeof useConversation>;
  renderRow: (row: ConversationRow) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* THE LOADING SWITCH (overview-loading §A, laws 1 and 4).
          `loaded` used to be read for exactly one thing — firing markSeen —
          so the whole of a cold channel's first fetch rendered the SETTLED
          empty state and then snapped to a full conversation. "No messages
          here" is an answer; showing it before anyone has asked the
          question is a lie. Ghosts go into emptiness only, and the empty
          state waits until the fetch has settled. */}
      {!team ? (
        <div className="flex-1 flex items-center justify-center typo-body">{t.monitor.conv_pick_project}</div>
      ) : !conv.loaded && conv.rows.length === 0 ? (
        <ConversationGhostRows />
      ) : conv.rows.length === 0 ? (
        <ScenarioEmptyState
          className="flex-1 justify-center"
          art="chat"
          size="sm"
          title={t.monitor.conv_empty_title}
          subtitle={t.monitor.conv_empty_body}
        />
      ) : (
        <VirtualConversation
          rows={conv.rows}
          renderRow={renderRow}
          hasMore={conv.hasMore}
          onTopReached={conv.loadOlder}
          pinKey={conv.pinKey}
          revealKey={team.teamId}
        />
      )}

      {team && (
        <ConversationComposer
          teamId={team.teamId}
          teamName={team.teamName.replace(/^SDLC[ —-]*/i, '')}
          members={team.members}
          onSubmit={conv.enqueue}
        />
      )}
    </>
  );
}
