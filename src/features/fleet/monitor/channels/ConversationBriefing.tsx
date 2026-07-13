/* eslint-disable custom/no-hardcoded-jsx-text -- prototype variant; i18n at consolidation (plan P6). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { QuickAnswerBody } from '@/features/agents/quick-answer/QuickAnswerBody';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { ConversationSidebar } from './ConversationSidebar';
import { ConversationComposer } from './ConversationComposer';
import { VirtualConversation } from './VirtualConversation';
import { AssignmentCard, DeliberationCard, ProposalCard, TalkBubble } from './ConversationCards';
import { useConversation } from './useConversation';
import { dayLabel, type ConversationRow } from './conversationModel';
import type { StreamTeam } from './types';

/* ----------------------------------------------------------------------------
 * VARIANT A — "BRIEFING". The work lives IN the stream.
 *
 * Thesis: a team channel is not a chat that occasionally mentions work — the
 * work IS most of what happened. So don't hide it. Put assignments and
 * deliberations in the timeline as full-width BANDS, and let talk be narrow,
 * inset bubbles beside them.
 *
 * The separation is GEOMETRIC, not decorative: talk is ≤78% wide and hugs a
 * side; work spans the column edge-to-edge. You can tell what kind of thing a
 * row is from three metres away, without reading a word — which is what stops
 * the timeline degenerating into "chat with dashboards sprinkled in".
 *
 * Capability work and improvement dialog (D1) read as siblings here: both are
 * bands, one blue (assignment), one violet (deliberation), interleaved in real
 * chronology with the conversation that produced them.
 *
 * Trade-off it accepts: a busy team's timeline is mostly bands. If you came to
 * read the chat, the chat is a minority of the surface.
 * -------------------------------------------------------------------------- */

export function ConversationBriefing({ teams }: { teams: StreamTeam[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);

  useEffect(() => {
    if (!activeId && teams[0]) setActiveId(teams[0].teamId);
  }, [teams, activeId]);

  const team = useMemo(() => teams.find((t) => t.teamId === activeId) ?? null, [teams, activeId]);
  const conv = useConversation(activeId);

  // Opening a conversation marks it read — the sidebar badge is the D6 watermark.
  useEffect(() => {
    if (conv.loaded) conv.markSeen();
  }, [conv, activeId]);

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

  const renderRow = useCallback(
    (row: ConversationRow) => {
      switch (row.kind) {
        case 'day':
          return (
            <div className="flex items-center gap-2 py-2">
              <span className="flex-1 h-px bg-border" />
              <span className="typo-caption text-foreground opacity-40">{dayLabel(row.at)}</span>
              <span className="flex-1 h-px bg-border" />
            </div>
          );
        case 'talk':
          return <TalkBubble item={row.item} onOpen={setDetail} />;
        case 'assignment':
          return (
            <AssignmentCard
              assignmentId={row.assignmentId}
              items={row.items}
              expanded={expanded.has(row.key)}
              onToggle={() => toggle(row.key)}
            />
          );
        case 'deliberation':
          return (
            <DeliberationCard
              deliberation={conv.delibIndex.get(row.deliberationId)}
              items={row.items}
              expanded={expanded.has(row.key)}
              onToggle={() => toggle(row.key)}
            />
          );
        case 'proposal':
          return (
            <ProposalCard
              proposal={row.proposal}
              onConfirm={() => void conv.confirmProposal(row.proposal)}
              onDismiss={() => conv.dropProposal(row.proposal.goal)}
            />
          );
      }
    },
    [expanded, toggle, conv],
  );

  return (
    <div className="h-full flex min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
      <div className="flex-shrink-0 w-[280px] min-h-0">
        <ConversationSidebar teams={teams} activeId={activeId} onSelect={setActiveId} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {!team ? (
          <div className="flex-1 flex items-center justify-center typo-body text-foreground opacity-50">
            Pick a project
          </div>
        ) : conv.rows.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
            <div className="relative">
              <div className="absolute inset-0 -m-6 rounded-full bg-primary/10 blur-2xl" />
              <MessagesSquare className="relative w-8 h-8 text-foreground opacity-70" />
            </div>
            <p className="typo-body text-foreground">Nothing here yet</p>
            <p className="typo-caption text-foreground opacity-50 max-w-xs">
              Say something to the team, or describe a piece of work and it'll be routed to whoever fits.
            </p>
          </div>
        ) : (
          <VirtualConversation
            rows={conv.rows}
            renderRow={renderRow}
            hasMore={conv.hasMore}
            onTopReached={conv.loadOlder}
          />
        )}

        {team && (
          <ConversationComposer
            teamId={team.teamId}
            teamName={team.teamName.replace(/^SDLC[ —-]*/i, '')}
            members={team.members}
            posting={conv.posting}
            onSend={conv.send}
            onProposal={conv.addProposal}
          />
        )}
      </div>

      <div className="flex-shrink-0 w-[320px] min-h-0 border-l border-border bg-foreground/[0.012] flex flex-col">
        <div className="flex-shrink-0 h-9 px-3 flex items-center border-b border-border">
          <span className="typo-label uppercase tracking-wider text-foreground opacity-60">Quick answer</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <QuickAnswerBody />
        </div>
      </div>

      <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
