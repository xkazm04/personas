/**
 * A Claude plan whose re-login needs the operator, as ONE quick decision on the
 * orb (spark claude-plan-switch).
 *
 * Athena speaks on two dimensions only: the chat window carries the full story,
 * the orb a quick decision. A re-login that stops at "needs you" (a profile that
 * must be signed in by hand, a Proton second factor, a captcha) is exactly a
 * quick decision: "<email>: <reason>" with Re-login and Dismiss. It is NEVER a
 * toast and never a standalone popup; the strip's row says the same thing in
 * detail where the operator is looking at plans.
 *
 * The decision id carries the run's start stamp, so a LATER needs-you run for
 * the same plan is a new question even after an earlier one was dismissed.
 */
import { reloginClaudeAccount } from '@/api/fleet/claudeAccounts';
import { getActiveTranslations, interpolate } from '@/i18n/useTranslation';
import type { ClaudeAccountView } from '@/lib/bindings/ClaudeAccountView';
import { reloginReasonLabel } from '@/features/fleet/monitor/grid/usage/reloginModel';
import { skipDecision } from './decisionDeferral';
import type { PendingDecision } from './types';

/** The accounts of a snapshot that are waiting on the operator. */
export function needsYouAccounts(accounts: readonly ClaudeAccountView[]): ClaudeAccountView[] {
  return accounts.filter((a) => a.relogin?.phase === 'needs_you');
}

export function reloginToDecision(account: ClaudeAccountView): PendingDecision {
  const t = getActiveTranslations();
  const reason = reloginReasonLabel(t, account.relogin?.reason ?? 'other');
  const id = `claude_relogin:${account.id}:${account.relogin?.startedAtMs ?? 0}`;
  return {
    id,
    prompt: interpolate(t.monitor.usage_relogin_decision, { email: account.email, reason }),
    options: [
      {
        key: 'relogin',
        label: t.monitor.usage_relogin_action,
        // A rejected command keeps the decision pending and says so in place (runDecisionOption).
        run: async () => {
          await reloginClaudeAccount(account.id);
        },
      },
      {
        key: 'dismiss',
        label: t.common.dismiss,
        danger: true,
        // Session-scoped, like every skip: the plan is still dead tomorrow.
        run: () => skipDecision(id),
      },
    ],
    recommendation: reason,
    source: 'claude_relogin',
    sourceRef: account.id,
    payload: JSON.stringify({
      account_id: account.id,
      email: account.email,
      reason: account.relogin?.reason ?? null,
      trigger: account.relogin?.trigger ?? null,
    }),
  };
}
