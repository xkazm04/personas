/* eslint-disable custom/no-hardcoded-jsx-text -- Conversations i18n lands with the P6 sweep. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, MessagesSquare, Scale, Sparkles } from 'lucide-react';
import { QuickAnswerBody } from '@/features/agents/quick-answer/QuickAnswerBody';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import { createTeamMemory } from '@/api/pipeline/teamMemories';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';
import { ConversationSidebar } from './ConversationSidebar';
import { ConversationComposer } from './ConversationComposer';
import { VirtualConversation } from './VirtualConversation';
import { AssignmentCard, DeliberationCard, ProposalCard, TalkBubble } from './ConversationCards';
import { DeliberationRail } from './DeliberationRail';
import { ReviewsRail } from './ReviewsRail';
import { useConversation } from './useConversation';
import { dayLabel, type ConversationRow } from './conversationModel';
import type { StreamTeam } from './types';

/* ----------------------------------------------------------------------------
 * CONVERSATIONS — the Monitor's messenger, and the only place you write (D5).
 *
 * THE LAYOUT ARGUMENT (the /prototype question, and its answer): a team channel
 * is not a chat that occasionally mentions work — the work IS most of what
 * happened. So the work lives IN the stream, as full-width BANDS, with talk as
 * narrow inset bubbles beside them. The separation is GEOMETRIC: you can tell
 * what kind of thing a row is without reading a word, which is what stops the
 * timeline degenerating into "chat with dashboards sprinkled in".
 *
 * Capability work (blue) and improvement dialogue (violet) read as siblings,
 * interleaved in real chronology with the conversation that produced them —
 * which is the whole of D1.
 *
 * What the bands DON'T carry is machinery. A card that also held advance /
 * run-to-budget / split / escalate would be the dashboard-in-a-chat this thesis
 * rejects. Focus a card and its controls appear in the RAIL. That split is what
 * lets the Teams Collab and Deliberations panes be deleted without loss.
 * -------------------------------------------------------------------------- */

type RailTab = 'focus' | 'reviews' | 'quick';

export function ConversationBriefing({
  teams, layoutControl,
}: {
  teams: StreamTeam[];
  layoutControl?: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);
  const [focusDelib, setFocusDelib] = useState<string | null>(null);
  const [tab, setTab] = useState<RailTab>('reviews');
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (!activeId && teams[0]) setActiveId(teams[0].teamId);
  }, [teams, activeId]);
  useEffect(() => {
    setFocusDelib(null);
    setTab('reviews');
  }, [activeId]);

  const team = useMemo(() => teams.find((t) => t.teamId === activeId) ?? null, [teams, activeId]);
  const conv = useConversation(activeId);
  const { loaded, markSeen } = conv;

  // Opening a conversation marks it read — the sidebar badge is the D6 watermark.
  useEffect(() => {
    if (loaded) markSeen();
  }, [loaded, markSeen, activeId]);

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

  /** Pin any row into the team's long-term memory (preserved from Collab). */
  const pin = useCallback(
    (item: TeamChannelItem) => {
      if (!activeId) return;
      const body = item.body ?? item.label;
      createTeamMemory({
        team_id: activeId,
        run_id: null,
        member_id: null,
        persona_id: item.personaId,
        title: body.slice(0, 80),
        content: body,
        category: 'context',
        importance: 5,
        tags: JSON.stringify({ source: 'conversation-pin' }),
      } satisfies CreateTeamMemoryInput)
        .then(() => {
          setPinned((p) => new Set(p).add(item.id));
          addToast('Pinned to team memory', 'success');
        })
        .catch(silentCatch('conversation:pin'));
    },
    [activeId, addToast],
  );

  const focusDeliberation = useCallback((id: string) => {
    setFocusDelib(id);
    setTab('focus');
  }, []);

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
              onFocus={() => focusDeliberation(row.deliberationId)}
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
    [expanded, toggle, conv, focusDeliberation],
  );

  const tabClass = (on: boolean) =>
    `px-2 py-0.5 rounded-interactive typo-label uppercase tracking-wider transition-colors ${
      on ? 'text-foreground bg-secondary/40' : 'text-foreground opacity-45 hover:opacity-80'
    }`;

  return (
    <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
      {layoutControl && (
        <div className="flex-shrink-0 h-11 px-3 flex items-center gap-2.5 border-b border-border bg-foreground/[0.015]">
          <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
            <MessagesSquare className="w-3.5 h-3.5 text-foreground" />
          </div>
          <span className="typo-body font-semibold text-foreground">Conversations</span>
          <div className="ml-auto">{layoutControl}</div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
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

        {/* THE RAIL — decision surfaces. Not messages, so not in the timeline. */}
        <div className="flex-shrink-0 w-[320px] min-h-0 border-l border-border bg-foreground/[0.012] flex flex-col">
          <div className="flex-shrink-0 h-9 px-2 flex items-center gap-1 border-b border-border">
            <button type="button" onClick={() => setTab('reviews')} className={tabClass(tab === 'reviews')}>
              <AlertCircle className="w-3 h-3 inline mr-1" />Reviews
            </button>
            <button
              type="button"
              onClick={() => setTab('focus')}
              disabled={!focusDelib}
              className={`${tabClass(tab === 'focus')} disabled:opacity-25`}
            >
              <Scale className="w-3 h-3 inline mr-1" />Deliberation
            </button>
            <button type="button" onClick={() => setTab('quick')} className={tabClass(tab === 'quick')}>
              <Sparkles className="w-3 h-3 inline mr-1" />Quick
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {tab === 'quick' && <QuickAnswerBody />}
            {tab === 'reviews' && team && <ReviewsRail members={team.members} />}
            {tab === 'focus' && team && focusDelib && (
              <DeliberationRail teamId={team.teamId} deliberationId={focusDelib} />
            )}
            {tab === 'focus' && !focusDelib && (
              <p className="typo-caption text-foreground opacity-45 p-2">
                Focus a deliberation in the conversation to drive it from here.
              </p>
            )}
          </div>
        </div>
      </div>

      <ChannelDetailModal
        item={detail}
        onClose={() => setDetail(null)}
        onPin={pin}
        pinned={detail ? pinned.has(detail.id) : false}
      />
    </div>
  );
}
