// AccountRows — the body of the usage strip: ONE ROW PER ACCOUNT, across every
// provider, each a single 28px line:
//
//   <provider mark>  <account>  <5h: timer · percent · pace>  <7d: calendar · percent · pace>
//   ═══════════ 7-day utilisation, as the row's bottom border ═══════════
//
// WHAT IS DELIBERATELY NOT HERE.
//   • NO STATUS ICONS. No check mark, no slot number, no power glyph, no shield.
//     The LIVE plan is said by emphasis alone — full opacity and a medium-weight
//     name — and a standby plan recedes to 60% until hovered or focused. A plan
//     that cannot be read says why IN WORDS, in the account slot.
//   • NO 5-HOUR BAR. The session window is a number and a pace glyph.
//   • ONE BAR ONLY: the 7-day window, drawn as a 2px fill along the row's bottom
//     edge in that window's tone (`FILL`). It is `aria-hidden` — the 7-day cluster
//     carries the sentence.
//
// EVERY CLUSTER SPEAKS A FULL SENTENCE (`windowSentence`: name, percent, reset
// countdown, pace, "Estimated") as its accessible name and its tooltip, because
// what is painted is three glyphs wide.
//
// THE ACTS ARE UNCHANGED. An inactive Claude plan that can be switched to is a
// clickable row — the account name is the real `<button>`, so the keyboard
// reaches it — and the switch still goes through its confirm, because it changes
// which plan the CLI's next message bills to. Forget is offered only where it is
// the honest act (a plan nothing could be read for), as a hover/focus-revealed
// icon button at the row's end: an ACTION, not a status. Codex and Grok rows are
// observed, never driven: no switch, no forget.
//
// A PROVIDER WITH NOTHING TO METER IS STILL ONE ROW: its mark, and the reason in
// words ("Not installed", "No sessions yet") where the account would be. Never a
// zeroed meter — 0% is a reading, and "not installed" is not.
//
// A DEAD CLAUDE PLAN IS NOT A DEAD END. A quarantined row says why in words and
// offers Re-login; while a run is in flight it shows the step; when a human is
// needed it says what for, in words (never a toast: the orb carries the quick
// decision, this row the detail); a plan's sign-in settings live behind a
// hover-revealed act. The row itself is `usage/PlanRow`; this file owns what
// several rows share: the two confirms and the settings dialog.

import { useCallback, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { GhostRow } from './UsageStripShell';
import { EmptyProviderRow } from './usage/RowParts';
import { PlanRow } from './usage/PlanRow';
import { ProfileSettings } from './usage/ProfileSettings';
import type { ReloginActs } from './usage/reloginActs';
import type { PlanModel, ResourceModel } from './usage/useResourceModel';

interface Props {
  model: ResourceModel;
  onSwitch: (id: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  /** The re-login acts; the strip passes the real ones or the simulation's. */
  relogin?: ReloginActs;
  /** The strip's clock (a done re-login decays against it). */
  now?: number;
}

type Pending = { kind: 'switch' | 'remove'; plan: PlanModel } | null;

/** No profiles, no acts: a strip that does not wire re-login still renders every row. */
const NO_ACTS: ReloginActs = {
  profiles: [],
  relogin: () => Promise.resolve(),
  openSignIn: () => Promise.resolve(),
  saveProfile: () => Promise.resolve(),
  setProfile: () => Promise.resolve(),
  listVaultLogins: () => Promise.resolve([]),
};

export function AccountRows({ model, onSwitch, onRemove, relogin = NO_ACTS, now = Date.now() }: Props) {
  const { t, tx } = useTranslation();
  const [pending, setPending] = useState<Pending>(null);
  const [settings, setSettings] = useState<PlanModel | null>(null);
  const cancel = useCallback(() => setPending(null), []);
  const ask = useCallback((kind: 'switch' | 'remove', plan: PlanModel) => setPending({ kind, plan }), []);
  const closeSettings = useCallback(() => setSettings(null), []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    try {
      if (pending.kind === 'switch') await onSwitch(pending.plan.id);
      else await onRemove(pending.plan.id);
    } finally {
      setPending(null);
    }
  }, [pending, onSwitch, onRemove]);

  const email = pending?.plan.name ?? '';
  const loading = model.providers.some((p) => p.pending);
  return (
    <>
      {model.providers.map((provider) => {
        // A read that has not settled: a ghost row under the permanent header, never a spinner.
        if (provider.pending) return <GhostRow key={provider.id} />;
        if (provider.plans.length === 0) return <EmptyProviderRow key={provider.id} provider={provider} />;
        // Receding exists to make the LIVE plan stand out. Where no plan is known
        // to be live (an install whose CLI never wrote an account uuid; a read-only
        // CLI, which has no such notion) nothing recedes: dimming every row would
        // read as "every plan is stale" rather than "we cannot tell which is live".
        const hasActive = provider.plans.some((p) => p.isActive);
        return provider.plans.map((plan) => (
          <PlanRow
            key={`${provider.id}:${plan.id}`}
            provider={provider}
            plan={plan}
            recede={hasActive && !plan.isActive}
            ask={ask}
            acts={relogin}
            now={now}
            onSettings={setSettings}
          />
        ));
      })}
      {/* Mounted for the strip's lifetime; only its TEXT is conditional, so the announcement has a change to fire on. */}
      <span className="sr-only" role="status">{loading ? t.monitor.usage_loading : ''}</span>

      {pending?.kind === 'switch' && (
        <ConfirmDialog
          title={tx(t.monitor.usage_accounts_switch_title, { email })}
          body={t.monitor.usage_accounts_switch_body}
          confirmLabel={t.monitor.usage_accounts_switch}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
      {pending?.kind === 'remove' && (
        <ConfirmDialog
          danger
          title={tx(t.monitor.usage_accounts_remove_title, { email })}
          body={t.monitor.usage_accounts_remove_body}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
      {settings && <ProfileSettings plan={settings} acts={relogin} onClose={closeSettings} />}
    </>
  );
}

export default AccountRows;
