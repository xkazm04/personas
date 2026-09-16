/**
 * ConversationVariant — Setup as a transcript.
 *
 * The metaphor is a conversation that leaves a record: guide turns and user
 * turns are rows, and the typed values the guide proposes are cards INSIDE
 * that record rather than a side panel, so accepting one is visibly part of
 * the same thread. A resolved card keeps its place wearing its verdict.
 *
 * Two deliberate choices worth keeping:
 *  - the composer is never disabled while a turn is in flight (the user may
 *    always type; the in-flight beat is a ghost row, not a locked input);
 *  - a suggestion is a POSITION, not a default. Picking one fills the
 *    composer; nothing is submitted until the user sends it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { SetupProposal, SetupVariantProps } from '../setupContract';
import { SetupProposalRow, type SetupProposalResolution } from '../SetupProposalRow';

const proposalKey = (p: SetupProposal) => `${p.kind}:${p.channel ?? ''}:${p.value.slice(0, 48)}`;

function TurnRow({ role, text, children }: { role: 'guide' | 'user'; text: string; children?: React.ReactNode }) {
  const isUser = role === 'user';
  return (
    <div className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`} data-testid={`setup-turn-${role}`}>
      {!isUser && (
        <span className="w-7 h-7 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
          <Wand2 className="w-3.5 h-3.5 text-primary" aria-hidden />
        </span>
      )}
      <div className={`min-w-0 max-w-[85%] flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
        {text && (
          <div
            className={`rounded-card typo-body leading-relaxed whitespace-pre-wrap px-3.5 py-2.5 ${
              isUser
                ? 'bg-primary/20 border border-primary/30 text-foreground'
                : 'bg-secondary/40 border border-foreground/10 text-foreground shadow-elevation-1'
            }`}
          >
            {text}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default function ConversationVariant({ session, voice }: SetupVariantProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  const [draft, setDraft] = useState('');
  const [resolved, setResolved] = useState<Record<string, SetupProposalResolution>>({});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [session.history.length, session.question, session.busy]);

  // Interim speech is shown, never acted on: it rides in the composer as a
  // preview so the user can see what was heard before it becomes their answer.
  const composerValue = voice.listening && voice.interim ? voice.interim : draft;

  // The live turn is only rendered when it is not already the tail of history.
  const tail = session.history[session.history.length - 1];
  const liveQuestion =
    session.question && !(tail?.role === 'guide' && tail.text === session.question) ? session.question : null;

  const mark = (p: SetupProposal, r: SetupProposalResolution) =>
    setResolved((prev) => ({ ...prev, [proposalKey(p)]: r }));

  const onAccept = async (p: SetupProposal) => {
    try {
      await session.accept(p);
      mark(p, 'accepted');
    } catch (err) {
      toastCatch('features/plugins/twin/setup/variants/ConversationVariant:accept')(err);
    }
  };

  const onEdit = (p: SetupProposal) => {
    setDraft(p.value);
    mark(p, 'edited');
  };

  const onDismiss = (p: SetupProposal) => {
    session.dismiss(p);
    mark(p, 'dismissed');
  };

  const renderProposals = (list: SetupProposal[] | undefined, recorded?: SetupProposalResolution) =>
    (list ?? []).map((p) => (
      <SetupProposalRow
        key={proposalKey(p)}
        proposal={p}
        resolution={recorded ?? resolved[proposalKey(p)]}
        onAccept={onAccept}
        onEdit={onEdit}
        onDismiss={onDismiss}
      />
    ));

  const chips = useMemo(() => session.suggestions.slice(0, 4), [session.suggestions]);

  const send = () => {
    const text = composerValue.trim();
    if (!text) return;
    setDraft('');
    void session.answer(text).catch(toastCatch('features/plugins/twin/setup/variants/ConversationVariant:answer'));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-5">
        <div className="max-w-[820px] mx-auto space-y-4" data-testid="setup-transcript">
          {session.history.map((entry) => (
            <TurnRow key={entry.id} role={entry.role} text={entry.text}>
              {renderProposals(entry.proposals, entry.resolution)}
            </TurnRow>
          ))}

          {liveQuestion && (
            <TurnRow role="guide" text={liveQuestion}>
              {renderProposals(session.proposals)}
            </TurnRow>
          )}

          {/* In-flight beat: a ghost row under the transcript's own chrome,
              bounded by the request. Never a spinner, never perpetual. */}
          {session.busy && (
            <TurnRow role="guide" text="">
              <div className="h-10 w-48 rounded-card bg-secondary/40 animate-pulse" aria-hidden />
              <span className="sr-only" role="status">{ts.conversation.thinking}</span>
            </TurnRow>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-primary/10 bg-card/40 px-4 md:px-6 xl:px-8 py-3">
        <div className="max-w-[820px] mx-auto space-y-2">
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="setup-suggestions">
              <Sparkles className="w-3.5 h-3.5 text-primary/70" aria-hidden />
              <span className="typo-caption uppercase tracking-[0.18em] mr-1">
                {ts.conversation.suggestionsLabel}
              </span>
              {chips.map((s) => (
                <button
                  key={s.text}
                  type="button"
                  onClick={() => setDraft(s.text)}
                  title={s.reason}
                  data-testid="setup-suggestion-chip"
                  className="px-2.5 py-1 rounded-full border border-primary/20 bg-secondary/30 typo-caption text-foreground hover:bg-secondary/60 hover:border-primary/35 transition-colors"
                >
                  {s.text}
                </button>
              ))}
            </div>
          )}
          <ChatInputBar
            value={composerValue}
            onChange={setDraft}
            onSubmit={send}
            multiline
            maxRows={5}
            placeholder={ts.conversation.placeholder}
            sendLabel={ts.conversation.send}
            sendTestId="setup-send"
            inputTestId="setup-composer"
            voice={{
              supported: voice.supported,
              listening: voice.listening,
              onToggle: voice.listening ? voice.stop : voice.start,
              startLabel: ts.voice.dictate,
              listeningLabel: ts.voice.stop,
            }}
          />
        </div>
      </div>
    </div>
  );
}
