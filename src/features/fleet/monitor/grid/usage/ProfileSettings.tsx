// ProfileSettings — one plan's sign-in settings, in a dialog reached from its row.
//
//   • Sign-in profile      the browser profile that signs this plan in (choose,
//                          or make one here — its key comes from its name);
//   • Code inbox profile   the profile whose Proton mailbox receives the emailed
//                          code (optional), and the vault login that fills it;
//   • Unattended           let the app re-login by itself when the profile is
//                          already signed in. Off by default.
//
// The FIRST sign-in of a profile is always by hand (Open sign-in window on the
// row): this dialog links, it never signs in. Edits are a draft until Save.

import { useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import { silentCatch } from '@/lib/silentCatch';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { FormField } from '@/features/shared/components/forms/FormField';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { PlanModel } from './useResourceModel';
import type { ReloginActs, VaultLogin } from './reloginActs';
import { NEW_PROFILE, draftOf, profileKeyFromLabel, type ProfileDraft } from './profileDraft';

const TEXT_FIELD = 'w-full rounded-input border border-border bg-background px-2 py-1.5 typo-body text-foreground';

export function ProfileSettings({
  plan, acts, onClose,
}: {
  plan: PlanModel;
  acts: ReloginActs;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftOf(plan.login));
  const [vault, setVault] = useState<VaultLogin[]>([]);
  const [vaultId, setVaultId] = useState<string | null>(null);
  const email = plan.name ?? '';
  const edit = (patch: Partial<ProfileDraft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    let live = true;
    acts.listVaultLogins().then((rows) => { if (live) setVault(rows); }).catch(silentCatch('monitor:profileVault'));
    return () => { live = false; };
  }, [acts]);

  const inboxProfile = acts.profiles.find((p) => p.key === draft.inbox) ?? null;
  // The inbox profile's bound login is the starting value; an edit overrides it.
  const boundId = vaultId ?? inboxProfile?.vaultCredentialId ?? '';

  const profileOptions = [
    { value: '', label: t.monitor.usage_profile_none },
    ...acts.profiles.map((p) => ({ value: p.key, label: p.label })),
  ];
  const newKey = profileKeyFromLabel(draft.newLabel);
  const creating = draft.signIn === NEW_PROFILE;

  const createProfile = async () => {
    if (!newKey) return;
    await acts.saveProfile(newKey, draft.newLabel.trim(), null);
    edit({ signIn: newKey, newLabel: '' });
  };

  const save = async () => {
    try {
      const signIn = creating ? '' : draft.signIn;
      if (inboxProfile && boundId !== (inboxProfile.vaultCredentialId ?? '')) {
        await acts.saveProfile(inboxProfile.key, inboxProfile.label, boundId || null);
      }
      await acts.setProfile(plan.id, signIn || null, draft.inbox || null, draft.unattended);
      onClose();
    } catch (err) {
      silentCatch('monitor:profileSave')(err);
    }
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="usage-profile-title"
      size="sm"
      panelClassName="rounded-modal border border-primary/25 bg-background/95 shadow-elevation-3 p-4"
      portal
    >
      <div className="flex flex-col gap-3" data-testid="fleet-usage-profile-dialog">
        <div id="usage-profile-title" className="typo-section-title">{tx(t.monitor.usage_profile_title, { email })}</div>

        <FormField label={t.monitor.usage_profile_sign_in} helpText={t.monitor.usage_profile_sign_in_help}>
          {(p) => (
            <ThemedSelect
              {...p}
              filterable
              hideSearch
              options={[...profileOptions, { value: NEW_PROFILE, label: t.monitor.usage_profile_new }]}
              value={draft.signIn}
              onValueChange={(v) => edit({ signIn: v })}
              placeholder={t.monitor.usage_profile_none}
            />
          )}
        </FormField>

        {creating && (
          <div className="flex items-end gap-2">
            <FormField label={t.monitor.usage_profile_new_label} className="min-w-0 flex-1">
              {(p) => (
                <input
                  {...p}
                  type="text"
                  value={draft.newLabel}
                  onChange={(e) => edit({ newLabel: e.target.value })}
                  className={TEXT_FIELD}
                  data-testid="fleet-usage-profile-new-label"
                />
              )}
            </FormField>
            <AsyncButton size="sm" variant="secondary" disabled={!newKey} onClick={createProfile} data-testid="fleet-usage-profile-create">
              {t.monitor.usage_profile_create}
            </AsyncButton>
          </div>
        )}

        <FormField label={t.monitor.usage_profile_inbox} helpText={t.monitor.usage_profile_inbox_help}>
          {(p) => (
            <ThemedSelect
              {...p}
              filterable
              hideSearch
              options={profileOptions}
              value={draft.inbox}
              onValueChange={(v) => { edit({ inbox: v }); setVaultId(null); }}
              placeholder={t.monitor.usage_profile_none}
            />
          )}
        </FormField>

        {inboxProfile && (
          <FormField label={t.monitor.usage_profile_vault} helpText={t.monitor.usage_profile_vault_help}>
            {(p) => (
              <ThemedSelect
                {...p}
                filterable
                hideSearch
                options={[{ value: '', label: t.monitor.usage_profile_vault_none }, ...vault.map((v) => ({ value: v.id, label: v.name }))]}
                value={boundId}
                onValueChange={setVaultId}
                placeholder={t.monitor.usage_profile_vault_none}
              />
            )}
          </FormField>
        )}

        <div className="flex items-start gap-2">
          <AccessibleToggle
            size="sm"
            checked={draft.unattended}
            onChange={() => edit({ unattended: !draft.unattended })}
            label={t.monitor.usage_profile_unattended}
            data-testid="fleet-usage-profile-unattended"
          />
          <div className="flex min-w-0 flex-col">
            <span className="typo-body text-foreground">{t.monitor.usage_profile_unattended}</span>
            <span className="typo-caption">{t.monitor.usage_profile_unattended_hint}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
          <AsyncButton size="sm" variant="primary" onClick={save} data-testid="fleet-usage-profile-save">{t.common.save}</AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}

export default ProfileSettings;
