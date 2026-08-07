import { Lightbulb, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { explainDecision, runDecisionOption } from './resolveDecision';

/**
 * The CHAT-side face of a pending orb decision.
 *
 * Athena has exactly two communication dimensions: the ORB carries quick info
 * and decisions, the CHAT window carries the full information. `OrbDecisionBubble`
 * docks against the orb, which does not exist while the chat panel is open — so
 * with the panel open (and the Fleet grid closed) the bubble returns null and
 * the queue will not pump a replacement, leaving a pending decision with NO
 * surface at all. Approvals and incident nudges happened to have their own chat
 * cards (`ApprovalCard` / `ProactiveCard`); human reviews, `adhoc` decisions,
 * and any future source did not.
 *
 * This card closes that hole for EVERY decision kind uniformly: it renders the
 * pending decision, with the same numbered options, the same `0`/explain
 * escalation, and the same in-place failure line, exactly when the bubble is
 * not rendering. Both surfaces resolve through `runDecisionOption`, so the two
 * dimensions never drift.
 *
 * Renders nothing when there is no pending decision or when the bubble has it.
 */
export function ChatDecisionCard() {
  const { t } = useTranslation();
  const decision = useCompanionStore((s) => s.pendingDecision);
  const companionState = useCompanionStore((s) => s.state);
  const explained = useCompanionStore((s) => s.decisionExplained);
  const composing = useCompanionStore((s) => s.explainComposing);
  const composeError = useCompanionStore((s) => s.explainComposeError);
  const runError = useCompanionStore((s) => s.decisionError);
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);

  // Exact complement of `OrbDecisionBubble`'s visibility predicate — never both,
  // never neither.
  const bubbleShowing = companionState === 'minimized' || fleetGridOpen;
  if (!decision || bubbleShowing) return null;

  return (
    <div
      data-testid="athena-chat-decision"
      data-companion-decision-id={decision.id}
      data-companion-decision-source={decision.source}
      className="rounded-card border border-primary/30 bg-primary/[0.05] p-3"
    >
      <p className="typo-label font-medium text-primary">
        {t.plugins.companion.decision_title}
      </p>
      <div data-testid="athena-chat-decision-prompt" className="mt-1">
        <MarkdownRenderer
          content={decision.prompt}
          className="typo-body text-foreground/90 leading-relaxed"
        />
      </div>

      {composing && (
        <div
          data-testid="athena-chat-decision-composing"
          className="mt-2.5 flex items-center gap-2 rounded-input border border-primary/20 bg-primary/5 px-3 py-2"
        >
          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" aria-hidden />
          <span className="typo-caption text-foreground">
            {t.plugins.companion.decision_composing}
          </span>
        </div>
      )}
      {!composing && composeError && (
        <p
          data-testid="athena-chat-decision-compose-failed"
          className="mt-2.5 typo-caption text-status-warning"
        >
          {t.plugins.companion.decision_compose_failed}
        </p>
      )}

      {runError && (
        <p
          data-testid="athena-chat-decision-run-failed"
          role="alert"
          className="mt-2.5 rounded-input border border-rose-500/25 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400"
        >
          {t.plugins.companion.decision_run_failed}
        </p>
      )}

      {explained && decision.recommendation && (
        <div
          data-testid="athena-chat-decision-recommendation"
          className="mt-2.5 rounded-input border border-primary/20 bg-primary/5 px-3 py-2.5"
        >
          <p className="typo-label font-medium text-primary">
            {t.plugins.companion.decision_recommend_prefix}
          </p>
          <MarkdownRenderer
            content={decision.recommendation}
            className="mt-1 typo-body text-foreground/90 leading-relaxed"
          />
          {decision.detail && (
            <p className="mt-1.5 typo-caption text-foreground leading-relaxed">
              {decision.detail}
            </p>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {decision.options.map((opt, i) => (
          <button
            key={opt.key}
            type="button"
            data-testid={`athena-chat-decision-option-${i + 1}`}
            onClick={() => runDecisionOption(opt)}
            title={opt.hint ?? opt.label}
            className={`inline-flex items-center gap-1.5 max-w-full rounded-interactive px-2.5 py-1.5 typo-caption font-medium transition-colors focus-ring ${
              opt.danger
                ? 'bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-400'
                : 'bg-primary/10 border border-primary/20 hover:bg-primary/20 text-primary'
            }`}
          >
            <span
              className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-medium ${
                opt.danger ? 'bg-rose-500/20' : 'bg-primary/20'
              }`}
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="text-left whitespace-normal break-words min-w-0">{opt.label}</span>
          </button>
        ))}
        <button
          type="button"
          data-testid="athena-chat-decision-option-0"
          onClick={() => explainDecision()}
          disabled={composing}
          aria-label={t.plugins.companion.decision_explain}
          title={t.plugins.companion.decision_explain_hint}
          className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-interactive bg-foreground/5 border border-foreground/10 hover:bg-foreground/10 text-foreground transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Lightbulb className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export default ChatDecisionCard;
