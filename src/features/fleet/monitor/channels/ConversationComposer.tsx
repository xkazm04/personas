import { Send, Wand2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Keycap } from '@/features/decision-center/deck/parts';
import '@/features/decision-center/deck/aurora.css';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import { goalText, looksLikeGoal } from './conversationModel';
import { MentionMenu } from './MentionMenu';
import { useComposerDraft } from './useComposerDraft';

/* ----------------------------------------------------------------------------
 * COMPOSER — where Assign dissolves.
 *
 * The Teams "Assign" surface (OrchestrationConsole) was a separate pane with its
 * own goal textarea and a Preview-routing button. That's a second place to type,
 * for a thing the conversation is already about. So it collapses in here: type a
 * goal, and instead of posting a remark the composer DECOMPOSES it
 * (`decompose_team_assignment_goal`) and drops a PROPOSAL CARD into the
 * conversation — routed steps, suggested personas — which you Confirm or drop.
 *
 * The preview-before-commit that the old console offered is exactly what the
 * proposal card is; nothing is lost by deleting the pane.
 *
 * Kept from CollabLiveCorrespondence (plan §7.3): per-team persisted draft,
 * @-mention autocomplete (Tab to complete), Enter to send, and the @athena
 * round-trip that makes the companion post back INTO the channel.
 *
 * IT DOES NOT DISABLE (plan Lane A). Submitting while a directive or a route is
 * in flight ENQUEUES — the prompt becomes a visible queued row and drains in
 * order — because a greyed-out button asks the operator to hold a sentence in
 * their head until a machine is ready for it. The composer's only job is to
 * take what was typed; deciding when it can be posted belongs to the outbox in
 * `useConversation`, which is also where the failure lands.
 * -------------------------------------------------------------------------- */

/* WP12: drawn in the deck's well (`au-well`), the send key printed once inside
 * the button, the same well the deck's reply composer uses. */

export function ConversationComposer({
  teamId, teamName, members, onSubmit,
}: {
  teamId: string;
  teamName: string;
  members: ChannelMember[];
  /** Accepts always. `goal` picks the outbox lane: route (decompose) or post. */
  onSubmit: (text: string, goal: boolean) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { draft, setDraft, ref, candidates, completeMention, mentionOpen, closeMention, onChange } = useComposerDraft(teamId, members);
  const isGoal = looksLikeGoal(draft);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    // Nothing is gated on an in-flight post: the outbox holds the order.
    onSubmit(isGoal ? goalText(text) : text, isGoal);
    setDraft('');
    if (!isGoal && /@athena\b/i.test(text)) {
      // Athena replies INTO the channel rather than into her own panel.
      useAthenaStore.getState().setPendingPrompt({
        text: `You were tagged in the ${teamName} team channel (team_id: ${teamId}). The user wrote:

"${text}"

Respond by posting a short reply INTO that team's channel via your post_team_message capability.`,
        autoSend: true,
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && candidates[0]) {
      e.preventDefault();
      completeMention(candidates[0].name);
      return;
    }
    if (e.key === 'Escape' && mentionOpen) {
      closeMention();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="au-scope relative flex-shrink-0 border-t border-border px-3 py-2">
      <MentionMenu candidates={candidates} onPick={completeMention} />
      {/* The composer TELLS you when it is about to spawn work rather than talk. */}
      {isGoal && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-status-info/30 bg-status-info/10 px-2 py-0.5 typo-caption text-status-info">
            <Wand2 className="h-3 w-3" aria-hidden /> {m.conv_composer_goal_hint}
          </span>
          <Tooltip content={m.conv_composer_plain}>
            <Button variant="ghost" size="icon-sm" onClick={() => setDraft((d) => `. ${d}`)} aria-label={m.conv_composer_plain}>
              <X className="h-3 w-3" aria-hidden />
            </Button>
          </Tooltip>
        </div>
      )}
      <div className="au-well flex items-end gap-2 rounded-input px-3 py-1">
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={tx(m.conv_composer_placeholder, { team: teamName })}
          aria-label={tx(m.conv_composer_placeholder, { team: teamName })}
          className="min-w-0 flex-1 resize-none bg-transparent py-1.5 typo-body text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={send}
          disabled={!draft.trim()}
          icon={isGoal ? <Wand2 className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          className={`au-lift mb-0.5 flex-shrink-0 ${isGoal ? 'text-status-info' : 'text-status-success'} [&>span:last-child]:inline-flex [&>span:last-child]:items-center [&>span:last-child]:gap-1.5`}
        >
          {isGoal ? m.conv_composer_route : m.conv_composer_send} <Keycap>↵</Keycap>
        </Button>
      </div>
    </div>
  );
}
