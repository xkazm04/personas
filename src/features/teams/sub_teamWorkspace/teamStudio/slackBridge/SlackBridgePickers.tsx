import { AlertTriangle } from 'lucide-react';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import type { ResourceItem } from '@/api/credentials/scopedResources';
import type { CredentialMetadata } from '@/lib/types/types';
import type { Persona } from '@/lib/bindings/Persona';
import type { BridgeForm } from './useTeamSlackBridge';

import { isCredentialVerified } from '@/lib/credentials/healthState';
function Field({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5" data-testid={testId}>
      <span className="typo-label text-foreground/85">{label}</span>
      {children}
    </label>
  );
}

/**
 * Credential / persona / Slack-channel pickers.
 *
 * The channel picker is the live one: `builtin-slack` declares a `channels`
 * resource, so `list_connector_resources` returns the channels the bot can
 * actually reach (cached 600s by the backend). When that call fails or the
 * workspace returns nothing, the field degrades to a plain channel-id input
 * rather than an empty dropdown the user cannot get past.
 */
export function SlackBridgePickers({
  form, onChange, members, slackCredentials, selectedPersona, channelItems, channelsLoading, channelsFailed,
}: {
  form: BridgeForm;
  onChange: (patch: Partial<BridgeForm>) => void;
  members: Persona[];
  slackCredentials: CredentialMetadata[];
  selectedPersona: Persona | null;
  channelItems: ResourceItem[];
  channelsLoading: boolean;
  channelsFailed: boolean;
}) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;

  const credentialOptions: ThemedSelectOption[] = slackCredentials.map((c) => ({
    value: c.id,
    label: c.name,
    description: isCredentialVerified(c) ? undefined : ts.slack_bridge_credential_unverified,
  }));

  const personaOptions: ThemedSelectOption[] = members.map((p) => ({
    value: p.id,
    label: p.name,
    description: p.enabled ? undefined : ts.slack_bridge_persona_disabled,
  }));

  const channelOptions: ThemedSelectOption[] = channelItems.map((item) => ({
    value: item.id,
    label: item.label,
    description: item.sublabel,
  }));

  const useChannelList = channelOptions.length > 0;

  return (
    <div className="space-y-3">
      <Field label={ts.slack_bridge_credential_label} testId="team-slack-bridge-credential">
        <ThemedSelect
          filterable
          hideSearch={slackCredentials.length < 6}
          options={credentialOptions}
          value={form.credentialId}
          onValueChange={(v) => onChange({ credentialId: v, channel: '', channelName: null })}
          placeholder={ts.slack_bridge_credential_placeholder}
        />
      </Field>

      <Field label={ts.slack_bridge_persona_label} testId="team-slack-bridge-persona">
        <ThemedSelect
          filterable
          hideSearch={members.length < 6}
          options={personaOptions}
          value={form.personaId}
          onValueChange={(v) => onChange({ personaId: v })}
          placeholder={ts.slack_bridge_persona_placeholder}
        />
        <p className="typo-caption font-normal text-foreground">{ts.slack_bridge_persona_hint}</p>
        {selectedPersona && !selectedPersona.enabled && (
          <p className="flex items-start gap-1.5 typo-caption font-normal text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            {ts.slack_bridge_persona_disabled_warning}
          </p>
        )}
      </Field>

      <Field label={ts.slack_bridge_channel_label} testId="team-slack-bridge-channel">
        {useChannelList ? (
          <ThemedSelect
            filterable
            options={channelOptions}
            value={form.channel}
            onValueChange={(v) =>
              onChange({ channel: v, channelName: channelItems.find((i) => i.id === v)?.label ?? null })
            }
            placeholder={ts.slack_bridge_channel_placeholder}
          />
        ) : (
          <input
            type="text"
            value={form.channel}
            disabled={!form.credentialId}
            onChange={(e) => onChange({ channel: e.target.value, channelName: null })}
            placeholder={ts.slack_bridge_channel_id_placeholder}
            className="w-full rounded-input bg-secondary/30 border border-primary/20 text-foreground typo-body px-3 py-2 focus:outline-none focus:border-primary/60 disabled:opacity-50"
          />
        )}
        {form.credentialId && !useChannelList && (
          <p className="typo-caption font-normal text-foreground">
            {channelsLoading
              ? ts.slack_bridge_channel_loading
              : channelsFailed
                ? ts.slack_bridge_channel_load_failed
                : ts.slack_bridge_channel_manual_hint}
          </p>
        )}
      </Field>
    </div>
  );
}

export default SlackBridgePickers;
