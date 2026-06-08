/**
 * GoalHandoffPanel — plain-language "hand this goal to your AI team" control.
 *
 * Replaces the developer-worded "Advance with team / builds an assignment from
 * the open to-dos (or decomposes the goal) and runs it" affordance. A
 * non-technical user gets one clear action and an inline confirm that explains,
 * in plain words, what starting the AI team will actually do — so kicking off
 * real (token-spending) work is a deliberate, understood choice.
 */
import { useState } from 'react';
import { Bot, ArrowRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

interface Props {
  /** A team assignment is already queued/running/awaiting-review for this goal. */
  hasActiveAssignment: boolean;
  /** The advance request is in flight (parent owns the async + toast). */
  advancing: boolean;
  /** Fire the hand-off (parent calls advanceTeamGoal + refresh). */
  onAdvance: () => void;
}

export function GoalHandoffPanel({ hasActiveAssignment, advancing, onAdvance }: Props) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="pt-3 mt-3 border-t border-primary/10">
      <div className="flex items-center gap-2 mb-2">
        <Bot className="w-3.5 h-3.5 text-violet-400" />
        <h3 className="typo-caption uppercase tracking-[0.18em] text-foreground">{dl.goal_handoff_label}</h3>
      </div>

      {hasActiveAssignment ? (
        <div className="flex items-center gap-2.5 rounded-card border border-violet-500/25 bg-violet-500/5 px-3 py-2">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400/60 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
          </span>
          <p className="typo-caption text-foreground">{dl.goal_handoff_active}</p>
        </div>
      ) : confirming ? (
        <div className="rounded-card border border-violet-500/25 bg-violet-500/5 px-3 py-3 space-y-2.5">
          <p className="typo-body text-foreground font-medium">{dl.goal_handoff_confirm_q}</p>
          <p className="typo-caption text-foreground leading-relaxed">{dl.goal_handoff_explain}</p>
          <div className="flex items-center gap-2">
            <Button
              variant="accent"
              accentColor="violet"
              size="sm"
              icon={<ArrowRight className="w-3.5 h-3.5" />}
              disabled={advancing}
              onClick={onAdvance}
            >
              {advancing ? dl.goal_advance_starting : dl.goal_handoff_start}
            </Button>
            <Button variant="ghost" size="sm" disabled={advancing} onClick={() => setConfirming(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="typo-caption text-foreground leading-relaxed">{dl.goal_handoff_explain}</p>
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={<Bot className="w-3.5 h-3.5" />}
            onClick={() => setConfirming(true)}
          >
            {dl.goal_handoff_button}
          </Button>
        </div>
      )}
    </div>
  );
}
