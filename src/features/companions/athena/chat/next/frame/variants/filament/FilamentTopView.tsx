/**
 * Filament · top segment — a lit pill flush on the top edge (contest B/1's
 * `.top-slim` + `.top-spread`, ported close to verbatim via `filament.css`).
 * Same data and verbs as `../../FrameTop.tsx` (conversation, latest reply,
 * quick replies, full transcript) — only the shell around them changes: a
 * pill instead of a frosted card, a sigil instead of her photo, a clip-path
 * unroll instead of growing the piece's own height.
 *
 * TODO(prototype, 2026-10-03): first in-app port of the contest winner.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { CompanionMessage } from '@/api/companion';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { ConversationSwitcher } from '../../../../../ConversationSwitcher';
import { DevOpLedger } from '../../../../../DevOpLedger';
import { QueuedMessages } from '../../../../../QueuedMessages';
import { QuickReplies } from '../../../../../QuickReplies';
import { stripModelDirectives } from '../../../../../athenaLabels';
import { useChatScroll } from '../../../../../useChatScroll';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { ExchangeTranscript } from '../../../ExchangeTranscript';
import { TurnPane } from '../../../NextPanes';
import type { Turn } from '../../../exchange';
import { NEXT_COPY as C } from '../../../nextCopy';
import { FrameKeys } from '../../FrameKeys';
import type { FrameLook } from '../../frameLook';
import './filament.css';

function latestReply(messages: CompanionMessage[]): CompanionMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'assistant' && !m.content.trimStart().startsWith('PROGRESS:')) return m;
  }
  return null;
}

/** The owl sigil: a drawn line-art mark, not her photo — the contest's own glyph. */
function Sigil({ spin }: { spin: boolean }) {
  return (
    <svg className="sigil" viewBox="0 0 32 32" aria-hidden>
      <circle className="ring" cx="16" cy="16" r="13" />
      <circle className={`arc${spin ? ' spin' : ''}`} cx="16" cy="16" r="9" style={spin ? { animation: 'filament-spin 1.6s linear infinite' } : undefined} />
      <path className="mark" d="M11 21 L16 10 L21 21 M13 17.5 H19" />
    </svg>
  );
}

export function FilamentTopView({
  look,
  engine,
  expanded,
  onExpand,
  onOpenWaiting,
}: {
  look: FrameLook;
  engine: AthenaChatEngine;
  expanded: boolean;
  onExpand: () => void;
  onOpenWaiting: () => void;
}) {
  const { t } = useTranslation();
  const streaming = useAthenaStore((s) => s.streaming);
  const beat = useAthenaStore((s) => s.streamingBeat);
  const quickReplies = useAthenaStore((s) => s.quickReplies);
  const devMode = useSystemStore((s) => s.athenaDevMode);
  const devAvailable = useAthenaStore((s) => s.devModeAvailable);
  const [turn, setTurn] = useState<Turn | null>(null);
  const conversations = useAthenaStore((s) => s.conversations);
  const activeConversationId = useAthenaStore((s) => s.activeConversationId);
  const conversationTitle =
    conversations.find((c) => c.id === activeConversationId)?.title ?? t.athena.name;
  const last = useMemo(() => latestReply(engine.messages), [engine.messages]);
  const reading = expanded && !turn;
  const { scrollRef, scrollToBottom, maybeAutoScroll } = useChatScroll(reading);
  const savedScroll = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!reading || !el) return;
    const saved = savedScroll.current;
    savedScroll.current = null;
    if (saved === null) scrollToBottom('auto');
    else el.scrollTop = saved;
  }, [reading, scrollRef, scrollToBottom]);
  useEffect(maybeAutoScroll, [engine.messages, engine.streaming, maybeAutoScroll]);

  return (
    <div className={`filament-frame${streaming ? ' working' : ''}${last ? '' : ' top-read'} relative`}>
      {!expanded && (
        <button
          type="button"
          onClick={onExpand}
          aria-label={C.expandConversation}
          aria-expanded={false}
          className="top-slim focus-ring"
          data-testid="companion-filament-top-slim"
        >
          <span className="node" aria-hidden>
            <Sigil spin={streaming} />
          </span>
          <span className="top-label knock">
            {streaming ? (
              <>
                <span className="typo-label state">{C.working}</span>
                <span className="typo-caption title">{beat ?? t.athena.working}</span>
                <span className="dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
              </>
            ) : last ? (
              // The mock's shape: a SHORT name on the line, the words themselves
              // only on hover (`.peek`) — the line must stay a line.
              <>
                <span className="typo-label title">{conversationTitle}</span>
                <span className="typo-caption peek">{stripModelDirectives(last.content).replace(/[`*#>-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)}</span>
              </>
            ) : (
              <span className="typo-label title">{C.noMessageYet}</span>
            )}
          </span>
          <span className="top-unread knock" aria-hidden>
            <span className="kbd typo-caption">Alt A</span>
            <span className="bead" style={{ ['--c' as string]: 'var(--primary)' }} />
          </span>
        </button>
      )}

      {expanded && (
      <div className="spread top-spread" role="region" aria-label={C.athena}>
        <span className="lit-edge" aria-hidden />
        <div className="ts-head">
          <span className="avatar auto" aria-hidden>
            <Sigil spin={streaming} />
          </span>
          <ConversationSwitcher />
          <span style={{ flex: 1 }} />
          <FrameKeys look={look} expanded={expanded} onExpand={onExpand} />
        </div>
        <Collapse open={devAvailable && devMode} unmountWhenClosed className="shrink-0">
          <DevOpLedger />
        </Collapse>

          <div ref={scrollRef} className="ts-body stagger">
            {turn ? (
              <>
                <button type="button" onClick={() => setTurn(null)} className="btn typo-body">
                  <ArrowLeft className="w-4 h-4" aria-hidden />
                  {C.backToChat}
                </button>
                <TurnPane turn={turn} />
              </>
            ) : (
              <ExchangeTranscript
                messages={engine.messages}
                streaming={engine.streaming}
                interactive={engine.initialized}
                onSend={engine.send}
                onOpenTurn={(next) => {
                  savedScroll.current = scrollRef.current?.scrollTop ?? null;
                  setTurn(next);
                }}
                onOpenWaiting={onOpenWaiting}
              />
            )}
            <div className="mt-2 flex flex-col gap-2">
              <QueuedMessages />
              {!streaming && <QuickReplies options={quickReplies} disabled={!engine.initialized} onPick={engine.send} />}
            </div>
          </div>
      </div>
      )}
    </div>
  );
}
