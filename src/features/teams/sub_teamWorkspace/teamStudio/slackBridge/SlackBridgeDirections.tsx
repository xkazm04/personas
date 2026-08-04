import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import type { BridgeForm } from './useTeamSlackBridge';

function ToggleRow({
  label, hint, checked, onChange, testId,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: () => void;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="typo-body text-foreground">{label}</div>
        {hint && <p className="typo-caption font-normal text-foreground">{hint}</p>}
      </div>
      <AccessibleToggle
        checked={checked}
        onChange={onChange}
        label={label}
        size="sm"
        data-testid={testId}
      />
    </div>
  );
}

/**
 * The four direction switches. Inbound is one wire (Slack messages arrive in
 * the team channel and reach personas the way a directive does); outbound is
 * three, because the three things a team channel emits differ wildly in volume
 * and an operator almost always wants steps off.
 */
export function SlackBridgeDirections({
  form, onChange, disabled,
}: {
  form: BridgeForm;
  onChange: (patch: Partial<BridgeForm>) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;

  return (
    <div className={`space-y-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <span className="typo-label uppercase tracking-wider text-foreground/85">
        {ts.slack_bridge_directions_heading}
      </span>
      <ToggleRow
        label={ts.slack_bridge_inbound_label}
        hint={ts.slack_bridge_inbound_hint}
        checked={form.pollInbound}
        onChange={() => onChange({ pollInbound: !form.pollInbound })}
        testId="team-slack-bridge-toggle-inbound"
      />
      <ToggleRow
        label={ts.slack_bridge_outbound_messages_label}
        hint={ts.slack_bridge_outbound_messages_hint}
        checked={form.outboundMessages}
        onChange={() => onChange({ outboundMessages: !form.outboundMessages })}
        testId="team-slack-bridge-toggle-messages"
      />
      <ToggleRow
        label={ts.slack_bridge_outbound_directives_label}
        hint={ts.slack_bridge_outbound_directives_hint}
        checked={form.outboundDirectives}
        onChange={() => onChange({ outboundDirectives: !form.outboundDirectives })}
        testId="team-slack-bridge-toggle-directives"
      />
      <ToggleRow
        label={ts.slack_bridge_outbound_steps_label}
        hint={ts.slack_bridge_outbound_steps_hint}
        checked={form.outboundSteps}
        onChange={() => onChange({ outboundSteps: !form.outboundSteps })}
        testId="team-slack-bridge-toggle-steps"
      />
    </div>
  );
}

export default SlackBridgeDirections;
