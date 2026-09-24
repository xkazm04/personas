/** MessagesQuick - the Messages page's inline setup: where this agent talks
 *  to you. The persona inbox is always on (the compose surfaces pin it); every
 *  healthy messaging or email credential with a delivery adapter is a toggle.
 *  A toggled channel is written as the same ChannelSpecV2 the messaging picker
 *  writes, with no destination; a channel that needs one (a Slack channel, a
 *  chat id) is marked, and the destination is set under More options. */
import { Inbox } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { AccessibleToggle } from "@/features/shared/components/forms/AccessibleToggle";
import { useHealthyConnectors, type HealthyConnector } from "@/features/agents/shared/quickConfig/useHealthyConnectors";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import type { ChannelSpecV2Type } from "@/lib/bindings/ChannelSpecV2Type";
import type { ComposeQuickSetup } from "@/features/agents/sub_glyph/useComposeConfig";
import { isFullyConfigured } from "@/features/agents/sub_glyph/commandPanel/messagingChannelDefaults";
import { BrandMark } from "./BrandMark";
import { MoreButton } from "./MoreButton";
import { QS } from "./copy";

/** Credential service type to the dispatcher's channel type. Mirrors the
 *  messaging picker's mapping; services with no delivery adapter are skipped. */
const CHANNEL_OF: Record<string, ChannelSpecV2Type> = {
  slack: "slack", telegram: "telegram", discord: "discord", microsoft_teams: "teams",
  gmail: "email", sendgrid: "email", resend: "email",
};

interface Pickable { type: ChannelSpecV2Type; connector: HealthyConnector }

function Row({ icon, label, note, warn, children }: { icon: React.ReactNode; label: string; note?: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-card-border last:border-b-0">
      {icon}
      <span className="flex flex-col min-w-0 flex-1">
        <span className="typo-body text-foreground truncate">{label}</span>
        {note && <span className={`typo-caption ${warn ? "text-status-warning" : "text-foreground"}`}>{note}</span>}
      </span>
      {children}
    </div>
  );
}

export function MessagesQuick({ quick, onMore }: { quick: ComposeQuickSetup; onMore: () => void }) {
  const { t } = useTranslation();
  const healthy = useHealthyConnectors();
  const picks: Pickable[] = useMemo(() => healthy.flatMap((c) => {
    const type = CHANNEL_OF[c.name];
    return type && (c.category === "messaging" || c.category === "email") ? [{ type, connector: c }] : [];
  }), [healthy]);
  const channels = quick.config.notificationChannels;
  const specOf = (p: Pickable): ChannelSpecV2 | undefined =>
    channels.find((c) => c.type === p.type && c.credential_id === p.connector.credentialId);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <Row
          icon={<span aria-hidden className="w-8 h-8 shrink-0 rounded-interactive flex items-center justify-center bg-secondary/40"><Inbox className="w-4 h-4" /></span>}
          label={t.agents.messaging_picker.builtin_label}
          note={QS.messages.alwaysOn}
        >
          <AccessibleToggle checked onChange={() => undefined} disabled label={t.agents.messaging_picker.builtin_label} />
        </Row>
        {picks.map((p) => {
          const spec = specOf(p);
          const needsDest = !!spec && !isFullyConfigured(spec);
          return (
            <Row
              key={`${p.type}:${p.connector.credentialId}`}
              icon={<BrandMark meta={p.connector.meta} size={32} />}
              label={p.connector.meta.label}
              note={needsDest ? QS.messages.needsDestination : undefined}
              warn={needsDest}
            >
              <AccessibleToggle
                checked={!!spec}
                label={p.connector.meta.label}
                onChange={() => quick.toggleChannel(spec ?? {
                  type: p.type, enabled: true, credential_id: p.connector.credentialId,
                  use_case_ids: "*", event_filter: null, config: null,
                })}
              />
            </Row>
          );
        })}
      </div>
      {picks.length === 0 && <p className="typo-body text-foreground">{QS.messages.noChannels}</p>}
      <MoreButton label={QS.more} onClick={onMore} />
    </div>
  );
}
