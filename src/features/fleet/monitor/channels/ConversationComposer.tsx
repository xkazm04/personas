import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Wand2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { decomposeTeamAssignmentGoal } from '@/api/pipeline/assignments';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { silentCatch } from '@/lib/silentCatch';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import type { AssignProposal } from './conversationModel';
import { goalText, looksLikeGoal } from './conversationModel';

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
 * -------------------------------------------------------------------------- */

const DRAFT_PREFIX = 'personas.channel.draft.';

export function ConversationComposer({
  teamId, teamName, members, posting, onSend, onProposal,
}: {
  teamId: string;
  teamName: string;
  members: ChannelMember[];
  posting: boolean;
  onSend: (text: string) => void;
  onProposal: (p: AssignProposal) => void;
}) {
  const { t, tx } = useTranslation();
  const [draft, setDraft] = useState('');
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const [decomposing, setDecomposing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Draft persists per team — switching projects must not lose what you typed.
  useEffect(() => {
    try {
      setDraft(localStorage.getItem(DRAFT_PREFIX + teamId) ?? '');
    } catch {
      setDraft('');
    }
  }, [teamId]);
  useEffect(() => {
    try {
      if (draft.trim()) localStorage.setItem(DRAFT_PREFIX + teamId, draft);
      else localStorage.removeItem(DRAFT_PREFIX + teamId);
    } catch (e) {
      silentCatch('conversation:draft')(e);
    }
  }, [draft, teamId]);

  // Autosize.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const mentionQuery = mentionAt === null ? null : draft.slice(mentionAt + 1).toLowerCase();
  const candidates =
    mentionQuery === null
      ? []
      : [{ personaId: 'athena', name: 'Athena' } as { personaId: string; name: string }, ...members]
          .filter((m) => m.name.toLowerCase().replace(/^t:\s*/, '').includes(mentionQuery))
          .slice(0, 5);

  const completeMention = useCallback(
    (name: string) => {
      if (mentionAt === null) return;
      const first = name.replace(/^T:\s*/, '').split(/\s+/)[0] ?? name;
      setDraft((d) => `${d.slice(0, mentionAt)}@${first} `);
      setMentionAt(null);
      ref.current?.focus();
    },
    [mentionAt],
  );

  const isGoal = looksLikeGoal(draft);

  const propose = async () => {
    const goal = goalText(draft);
    if (!goal || decomposing) return;
    setDecomposing(true);
    try {
      const steps = await decomposeTeamAssignmentGoal(teamId, goal);
      onProposal({
        goal,
        steps: steps.map((s) => ({
          title: s.title,
          description: s.description,
          suggestedPersonaId: s.suggestedPersonaId ?? null,
        })),
        status: 'pending',
      });
      setDraft('');
    } catch (e) {
      silentCatch('conversation:decompose')(e);
    } finally {
      setDecomposing(false);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || posting) return;
    if (isGoal) {
      void propose();
      return;
    }
    onSend(text);
    setDraft('');
    if (/@athena\b/i.test(text)) {
      // Athena replies INTO the channel rather than into her own panel.
      useCompanionStore.getState().setPendingPrompt({
        text: `You were tagged in the ${teamName} team channel (team_id: ${teamId}). The user wrote:\n\n"${text}"\n\nRespond by posting a short reply INTO that team's channel via your post_team_message capability.`,
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
    if (e.key === 'Escape' && mentionAt !== null) {
      setMentionAt(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setDraft(v);
    const caret = e.target.selectionStart ?? v.length;
    const upto = v.slice(0, caret);
    const at = upto.lastIndexOf('@');
    setMentionAt(at >= 0 && !/\s/.test(upto.slice(at + 1)) ? at : null);
  };

  return (
    <div className="relative flex-shrink-0 border-t border-border bg-foreground/[0.02] px-3 py-2">
      {candidates.length > 0 && (
        <div className="absolute bottom-full left-3 mb-1 z-20 min-w-[200px] rounded-card border border-border bg-background shadow-elevation-3 p-1">
          {candidates.map((m, i) => (
            <button
              key={m.personaId}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); completeMention(m.name); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-interactive text-left typo-caption transition-colors ${
                i === 0 ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-secondary/40'
              }`}
            >
              {m.personaId === 'athena' && <Sparkles className="w-3 h-3 text-violet-300 flex-shrink-0" />}
              <span className="truncate">{m.name.replace(/^T:\s*/, '')}</span>
              {i === 0 && <span className="ml-auto typo-caption opacity-40">Tab</span>}
            </button>
          ))}
        </div>
      )}

      {/* The composer TELLS you when it's about to spawn work rather than talk. */}
      {isGoal && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-status-info/30 bg-status-info/10 typo-caption text-status-info">
            <Wand2 className="w-3 h-3" /> {t.monitor.conv_composer_goal_hint}
          </span>
          <button
            type="button"
            onClick={() => setDraft((d) => `. ${d}`)}
            title={t.monitor.conv_composer_plain}
            className="p-0.5 rounded-full text-foreground opacity-40 hover:opacity-100 transition-opacity"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={tx(t.monitor.conv_composer_placeholder, { team: teamName })}
          className="flex-1 resize-none px-3 py-2 rounded-input bg-secondary/30 border border-border typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim() || posting || decomposing}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-interactive border typo-body transition-colors disabled:opacity-40 ${
            isGoal
              ? 'border-status-info/30 bg-status-info/10 text-status-info hover:bg-status-info/20'
              : 'border-status-success/30 bg-status-success/10 text-status-success hover:bg-status-success/20'
          }`}
        >
          {isGoal ? <Wand2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          {decomposing ? t.monitor.conv_composer_routing : isGoal ? t.monitor.conv_composer_route : t.monitor.conv_composer_send}
        </button>
      </div>
    </div>
  );
}
