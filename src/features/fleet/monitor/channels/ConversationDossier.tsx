/* eslint-disable custom/no-hardcoded-jsx-text -- prototype variant; i18n at consolidation (plan P6). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessagesSquare, Scale, Sparkles, Wand2 } from 'lucide-react';
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
 * VARIANT B — "DOSSIER". The stream stays pure; the work sits beside it.
 *
 * Thesis: the moment you put a dashboard inside a chat, it stops being a chat.
 * Bubbles and progress strips are different modes of reading, and interleaving
 * them makes both worse — you scroll past the conversation to find the work, and
 * past the work to find the conversation.
 *
 * So the timeline holds only what someone SAID. An assignment or a deliberation
 * appears as a slim one-line ANCHOR — "▸ Ship v0.38 · 4/6" — marking WHEN it
 * happened, and nothing more. Click it and the full card opens in the right rail,
 * which is the dashboard. Focus is the primary interaction (D1's "focused
 * deliberation" made literal).
 *
 * Trade-off it accepts: you can't see a run's progress without clicking. The
 * conversation is quiet, but the work is one interaction further away.
 * -------------------------------------------------------------------------- */

type Focus =
  | { kind: 'assignment'; id: string; items: TeamChannelItem[] }
  | { kind: 'deliberation'; id: string; items: TeamChannelItem[] }
  | null;

export function ConversationDossier({ teams }: { teams: StreamTeam[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [tab, setTab] = useState<'focus' | 'quick'>('focus');
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);

  useEffect(() => {
    if (!activeId && teams[0]) setActiveId(teams[0].teamId);
  }, [teams, activeId]);
  useEffect(() => setFocus(null), [activeId]);

  const team = useMemo(() => teams.find((t) => t.teamId === activeId) ?? null, [teams, activeId]);
  const conv = useConversation(activeId);

  useEffect(() => {
    if (conv.loaded) conv.markSeen();
  }, [conv, activeId]);

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
              dense
              assignmentId={row.assignmentId}
              items={row.items}
              expanded={false}
              onToggle={() => {
                setFocus({ kind: 'assignment', id: row.assignmentId, items: row.items });
                setTab('focus');
              }}
            />
          );
        case 'deliberation':
          return (
            <DeliberationCard
              dense
              deliberation={conv.delibIndex.get(row.deliberationId)}
              items={row.items}
              expanded={false}
              onToggle={() => {
                setFocus({ kind: 'deliberation', id: row.deliberationId, items: row.items });
                setTab('focus');
              }}
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
    [conv],
  );

  const tabClass = (on: boolean) =>
    `px-2 py-0.5 rounded-interactive typo-label uppercase tracking-wider transition-colors ${
      on ? 'text-foreground bg-secondary/40' : 'text-foreground opacity-45 hover:opacity-80'
    }`;

  return (
    <div className="h-full flex min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
      <div className="flex-shrink-0 w-[280px] min-h-0">
        <ConversationSidebar teams={teams} activeId={activeId} onSelect={setActiveId} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {!team ? (
          <div className="flex-1 flex items-center justify-center typo-body text-foreground opacity-50">Pick a project</div>
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
          <VirtualConversation rows={conv.rows} renderRow={renderRow} hasMore={conv.hasMore} onTopReached={conv.loadOlder} />
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

      {/* THE DASHBOARD — everything the timeline refuses to carry. */}
      <div className="flex-shrink-0 w-[320px] min-h-0 border-l border-border bg-foreground/[0.012] flex flex-col">
        <div className="flex-shrink-0 h-9 px-2 flex items-center gap-1 border-b border-border">
          <button type="button" onClick={() => setTab('focus')} className={tabClass(tab === 'focus')}>Focus</button>
          <button type="button" onClick={() => setTab('quick')} className={tabClass(tab === 'quick')}>
            <Sparkles className="w-3 h-3 inline mr-1" />Quick
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {tab === 'quick' ? (
            <QuickAnswerBody />
          ) : !focus ? (
            <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center px-4">
              <span className="flex items-center gap-1.5">
                <Wand2 className="w-4 h-4 text-status-info opacity-60" />
                <Scale className="w-4 h-4 text-violet-300 opacity-60" />
              </span>
              <p className="typo-caption text-foreground opacity-50">
                Click an assignment or deliberation in the conversation to open it here.
              </p>
            </div>
          ) : focus.kind === 'assignment' ? (
            <AssignmentCard assignmentId={focus.id} items={focus.items} expanded onToggle={() => setFocus(null)} />
          ) : (
            <DeliberationCard
              deliberation={conv.delibIndex.get(focus.id)}
              items={focus.items}
              expanded
              onToggle={() => setFocus(null)}
            />
          )}
        </div>
      </div>

      <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
