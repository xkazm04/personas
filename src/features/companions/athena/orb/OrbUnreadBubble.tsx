/**
 * OrbUnreadBubble — the reply you missed, said out loud where you can see it.
 *
 * The orb could already tell you that N replies had landed while the chat was
 * closed. A count is a poor signal: it says something happened without saying
 * whether it can wait, so the only way to triage was to open the chat — which
 * is exactly the interruption the minimized presence exists to avoid. This
 * surfaces the reply ITSELF, short, docked above the orb, with the two things
 * you'd want next: hear it again, or open the conversation.
 *
 * It shares the orb's docking geometry with `OrbDecisionBubble` and defers to
 * it completely: a decision is a question addressed to you and a message is
 * not, so while one is pending this stays down. It renders under the same
 * presence rule as the decision bubble (minimized, or lifted over the fleet
 * grid) because it has nothing to dock against otherwise.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { MessageSquareText, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { BubbleReadAloud } from '../BubbleReadAloud';
import { useTtsSettings } from '../useTtsSettings';
import { useTtsVoiceSelection } from '../useTtsVoiceSelection';
import { orbDock } from './athenaOrbDock';

/** Longest preview we render before clamping. Enough for a real paragraph. */
const PREVIEW_CHARS = 420;

export function OrbUnreadBubble() {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const reduceMotion = useReducedMotion();

  const unreadReplies = useCompanionStore((s) => s.unreadReplies);
  const unreadPreview = useCompanionStore((s) => s.unreadPreview);
  const companionState = useCompanionStore((s) => s.state);
  const hasDecision = useCompanionStore((s) => s.pendingDecision != null);
  const orbTarget = useCompanionStore((s) => s.orbGuideTarget);
  const orbPos = useSystemStore((s) => s.companionOrbPos);
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);
  const voice = useTtsVoiceSelection();
  const voiceSettings = useTtsSettings();

  if (!unreadPreview || unreadReplies === 0) return null;
  // A decision is a question addressed to the operator; a message is news.
  // Never stack them — the question wins and this returns the moment it clears.
  if (hasDecision) return null;
  if (companionState !== 'minimized' && !fleetGridOpen) return null;

  const dock = orbDock(orbTarget, orbPos);
  const clamped = unreadPreview.length > PREVIEW_CHARS;
  // Cut on a word boundary — a preview that ends mid-word reads as corrupted
  // rather than shortened.
  const shown = clamped
    ? `${unreadPreview.slice(0, unreadPreview.lastIndexOf(' ', PREVIEW_CHARS))}…`
    : unreadPreview;

  const openChat = () => useCompanionStore.getState().setState('open');

  return (
    <motion.div
      data-testid="athena-unread-bubble"
      data-unread-count={unreadReplies}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`pointer-events-auto fixed ${fleetGridOpen ? 'z-[220]' : 'z-[61]'} w-[336px] max-w-[80vw]`}
      style={dock.pos}
    >
      <div className="relative rounded-card bg-background/95 border border-primary/25 shadow-elevation-3 p-3">
        <div className="flex items-center gap-1.5 pr-5">
          <MessageSquareText className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
          <span className="typo-caption font-medium text-primary">{c.orb_unread_title}</span>
          {unreadReplies > 1 && (
            <span className="typo-caption text-foreground opacity-70 tabular-nums">
              {tx(c.orb_unread_more, { count: unreadReplies - 1 })}
            </span>
          )}
        </div>

        {/* The reply itself. Clicking the text opens the chat — the whole point
            of showing it here is deciding whether to go read the rest. */}
        <button
          type="button"
          onClick={openChat}
          data-testid="athena-unread-open"
          aria-label={c.orb_unread_open}
          className="mt-1.5 block w-full text-left rounded-input px-1 -mx-1 py-0.5 hover:bg-foreground/[0.05] transition-colors focus-ring"
        >
          <MarkdownRenderer
            content={shown}
            className="athena-chat-md typo-caption leading-relaxed max-h-32 overflow-hidden"
          />
        </button>

        <div className="mt-2 flex items-center gap-1.5">
          {/* Replay reuses the transcript's own read-aloud control, so "hear it
              again" behaves identically wherever it appears — including its
              synthesizing / stop / failed states. It renders nothing when no
              voice engine is configured. */}
          <BubbleReadAloud content={unreadPreview} voice={voice} voiceSettings={voiceSettings} />
          <button
            type="button"
            onClick={openChat}
            data-testid="athena-unread-open-chat"
            className="inline-flex items-center gap-1 rounded-interactive bg-primary/10 border border-primary/20 hover:bg-primary/20 px-2 py-0.5 typo-caption font-medium text-primary transition-colors focus-ring"
          >
            {c.orb_unread_open}
          </button>
        </div>

        {/* Dismiss = mark read. Deliberately not "hide": leaving the badge up
            after the user has read the words here would make it lie. */}
        <button
          type="button"
          onClick={() => useCompanionStore.getState().clearUnreadReplies()}
          data-testid="athena-unread-dismiss"
          aria-label={c.orb_unread_dismiss}
          title={c.orb_unread_dismiss}
          className="absolute -top-2.5 -right-2.5 z-10 inline-flex items-center justify-center w-6 h-6 rounded-full bg-background/95 border border-primary/25 text-foreground shadow-elevation-2 ring-2 ring-background hover:border-primary/50 transition"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
}
