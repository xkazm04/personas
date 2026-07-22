/**
 * messagingChannelDefaults — single source of truth for the channel-level
 * facts every compose surface needs about `ChannelSpecV2`:
 *
 *   · the always-on built-in inbox spec
 *   · which destination fields each channel type requires to be
 *     deliverable, and the i18n keys that label/placeholder them
 *   · whether a given spec is "fully configured" (all required fields set)
 *
 * These used to be hand-duplicated across `useComposeConfig.tsx`,
 * `CommandPanelComposer.tsx`, `CommandPanelMessagingRow.tsx`, and
 * `ComposerMessagingPickerModal.tsx`. Import from here instead — the
 * required destination keys must match the dispatcher's `deliver_*`
 * adapters in `notifications.rs`.
 */
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import type { ChannelSpecV2Type } from "@/lib/bindings/ChannelSpecV2Type";

/** Always-on built-in inbox row (cannot be deselected in the Composer). */
export const BUILT_IN_INBOX: ChannelSpecV2 = {
  type: "built-in",
  enabled: true,
  credential_id: null,
  use_case_ids: "*",
  event_filter: null,
  config: null,
};

/** Per-channel destination field metadata — drives the picker's inline
 *  inputs. `labelKey`/`placeholderKey` index into the i18n bundle's
 *  `agents.messaging_picker.{field_labels,field_placeholders}` records. */
export type DestFieldKey = "channel" | "chat_id" | "channel_id" | "team_id" | "to";

export interface DestinationFieldDef {
  key: string;
  labelKey: DestFieldKey;
  placeholderKey: DestFieldKey;
}

export const DESTINATION_FIELDS: Record<ChannelSpecV2Type, DestinationFieldDef[]> = {
  "built-in": [],
  titlebar: [],
  slack: [{ key: "channel", labelKey: "channel", placeholderKey: "channel" }],
  telegram: [{ key: "chat_id", labelKey: "chat_id", placeholderKey: "chat_id" }],
  discord: [
    { key: "channel_id", labelKey: "channel_id", placeholderKey: "channel_id" },
  ],
  teams: [
    { key: "team_id", labelKey: "team_id", placeholderKey: "team_id" },
    { key: "channel_id", labelKey: "channel_id", placeholderKey: "channel_id" },
  ],
  email: [{ key: "to", labelKey: "to", placeholderKey: "to" }],
};

/**
 * Whether the spec is fully configured for delivery: every required
 * destination field has a non-empty value. Empty config means the
 * dispatcher will rely on the credential's scoped_resources fallback,
 * which may or may not be populated — callers surface that as
 * "incomplete" so the user sees the warning during build instead of at
 * delivery time.
 */
export function isFullyConfigured(spec: ChannelSpecV2): boolean {
  const fields = DESTINATION_FIELDS[spec.type] ?? [];
  if (fields.length === 0) return true;
  const cfg = spec.config as Record<string, unknown> | null;
  if (!cfg) return false;
  return fields.every((f) => {
    const v = cfg[f.key];
    return typeof v === "string" && v.trim().length > 0;
  });
}
