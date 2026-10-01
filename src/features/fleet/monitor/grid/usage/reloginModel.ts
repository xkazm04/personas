// reloginModel — what a plan row says about its re-login, as ONE pure function.
//
// The backend carries the latest run per account since the app started
// (`ClaudeAccountView.relogin`) and the account's own health
// (`quarantineReason`). The row needs a single answer to "what do I show beside
// the name, and which buttons do I offer":
//
//   none       nothing to say — a healthy plan with no run to report;
//   idle       the plan is dead and nothing is running — reason text + Re-login;
//   running    a run is in flight — the step chip; the Re-login control spins;
//   needs_you  a human is needed — the reason in words + Re-login + the window;
//   done       the plan is alive again — "Signed in again", briefly.
//
// `done` DECAYS: the state stays on the account until the next run, so it is
// shown only for `DONE_VISIBLE_MS` after the run STARTED (a run takes up to a
// couple of minutes, so the window is wider than the "brief" it feels like).

import type { ReloginReason } from '@/lib/bindings/ReloginReason';
import type { ReloginStep } from '@/lib/bindings/ReloginStep';
import type { Translations } from '@/i18n/generated/types';
import type { PlanModel } from './useResourceModel';

export const DONE_VISIBLE_MS = 3 * 60_000;

export type ReloginView =
  | { kind: 'none' }
  | { kind: 'idle' }
  | { kind: 'running'; step: ReloginStep | null }
  | { kind: 'needs_you'; reason: ReloginReason }
  | { kind: 'done' };

export function reloginView(plan: PlanModel, now: number): ReloginView {
  const r = plan.relogin;
  if (r?.phase === 'running') return { kind: 'running', step: r.step };
  if (r?.phase === 'needs_you') return { kind: 'needs_you', reason: r.reason ?? 'other' };
  if (r?.phase === 'done' && now - r.startedAtMs < DONE_VISIBLE_MS) return { kind: 'done' };
  return plan.state === 'quarantined' ? { kind: 'idle' } : { kind: 'none' };
}

/** The words for a reason. One string per variant, exhaustive on purpose. */
export function reloginReasonLabel(t: Translations, reason: ReloginReason): string {
  const m = t.monitor;
  const labels: Record<ReloginReason, string> = {
    chrome_missing: m.usage_relogin_reason_chrome_missing,
    profile_not_linked: m.usage_relogin_reason_profile_not_linked,
    profile_cold: m.usage_relogin_reason_profile_cold,
    google_challenge: m.usage_relogin_reason_google_challenge,
    cloudflare_challenge: m.usage_relogin_reason_cloudflare_challenge,
    captcha: m.usage_relogin_reason_captcha,
    code_inbox_not_linked: m.usage_relogin_reason_code_inbox_not_linked,
    code_not_found: m.usage_relogin_reason_code_not_found,
    proton_logged_out: m.usage_relogin_reason_proton_logged_out,
    proton_second_factor: m.usage_relogin_reason_proton_second_factor,
    selector_drift: m.usage_relogin_reason_selector_drift,
    identity_mismatch: m.usage_relogin_reason_identity_mismatch,
    cli_failed: m.usage_relogin_reason_cli_failed,
    timeout: m.usage_relogin_reason_timeout,
    rate_limited: m.usage_relogin_reason_rate_limited,
    busy: m.usage_relogin_reason_busy,
    other: m.usage_relogin_reason_other,
  };
  return labels[reason];
}

export function reloginStepLabel(t: Translations, step: ReloginStep | null): string {
  switch (step) {
    case 'waiting_for_code': return t.monitor.usage_relogin_step_waiting_for_code;
    case 'authorising': return t.monitor.usage_relogin_step_authorising;
    case 'saving': return t.monitor.usage_relogin_step_saving;
    case 'opening_profile':
    case null: return t.monitor.usage_relogin_step_opening_profile;
  }
}
