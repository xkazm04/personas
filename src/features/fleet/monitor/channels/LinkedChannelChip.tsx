import { Hash } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SLACK_BRAND } from '@/features/teams/sub_collab/collabRender';
import type { TeamSlackBridge } from '@/lib/channel/teamBridge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/**
 * PASSIVE linked-channel chip — "this conversation is also a Slack channel".
 *
 * Deliberately not a control. The bridge is configured on the persona's
 * notification channels; showing it here answers the only question the reader
 * of a conversation actually has ("who else can see this?") without pretending
 * the Monitor owns the wiring. It wears the same teal Slack voice as the
 * bridged messages below it, so the chip and the messages read as one system.
 */
export function LinkedChannelChip({ bridge }: { bridge: TeamSlackBridge | undefined }) {
  const { t } = useTranslation();
  if (!bridge) return null;

  const label = bridge.channel || SLACK_BRAND;
  return (
    <Tooltip content={t.monitor.conv_bridge_title}><span
      className="inline-flex items-center gap-1 flex-shrink-0 max-w-[180px] px-1.5 py-0.5 rounded-interactive border border-hair bg-surface-1 typo-caption text-status-success"
    >
      <Hash className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </span></Tooltip>
  );
}

export default LinkedChannelChip;
