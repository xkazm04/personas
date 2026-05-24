/**
 * ComposerMessagingPickerModal — opens from the Composer's "Messaging" row.
 *
 * Sibling of ComposerConnectorsPickerModal but scoped to delivery channels:
 *   · Lists vault credentials with `category === "messaging"` or `"email"`
 *     (joined via `useHealthyConnectors` so only healthy creds appear)
 *   · A pinned "Persona inbox" row is always selected and cannot be unchecked
 *   · Selected channels render full-width above the unselected grid with
 *     inline destination inputs (channel/chat_id/channel_id/etc.) so the
 *     picker writes a fully-deliverable `ChannelSpecV2[]` to the persona
 *     row — no Settings round-trip needed.
 *
 * Wire shape: `spec.config` carries the destination keys the Slice 1
 * dispatcher reads — `channel` for Slack, `chat_id` for Telegram,
 * `channel_id` for Discord, `team_id` + `channel_id` for Teams (Graph),
 * `to` for email. Empty config falls back to the credential's
 * scoped_resources at delivery time (Slice 1's `merged_channel_config`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Inbox, Plug, Check, AlertCircle, X } from "lucide-react";
import {
  useHealthyConnectors,
  type HealthyConnector,
} from "@/features/agents/shared/quickConfig/useHealthyConnectors";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import type { ChannelSpecV2Type } from "@/lib/bindings/ChannelSpecV2Type";
import type { JsonValue } from "@/lib/bindings/serde_json/JsonValue";
import { useTranslation } from "@/i18n/useTranslation";
import { ComposerPickerShell } from "./ComposerPickerShell";
import { ComposerBrandIcon } from "./ComposerBrandIcon";
import { DebtText } from '@/i18n/DebtText';


interface ComposerMessagingPickerModalProps {
  open: boolean;
  onClose: () => void;
  selected: ChannelSpecV2[];
  onApply: (next: ChannelSpecV2[]) => void;
  /** Forwarded to PickerShell — solid bg over translucent surfaces. */
  solid?: boolean;
}

/**
 * Map a vault credential's `service_type` to the dispatcher's channel-type
 * discriminator. Returns `null` when the credential is in a messaging
 * category but its delivery adapter isn't wired yet (Twilio SMS, the
 * built-in `local-messaging` proxy) — those are filtered out of the picker.
 */
function serviceTypeToChannelType(
  serviceType: string,
): ChannelSpecV2Type | null {
  switch (serviceType) {
    case "slack":
      return "slack";
    case "telegram":
      return "telegram";
    case "discord":
      return "discord";
    case "microsoft_teams":
      return "teams";
    case "gmail":
    case "sendgrid":
    case "resend":
      return "email";
    default:
      return null;
  }
}

/** Per-channel destination field metadata — drives the inline inputs.
 *  `labelKey`/`placeholderKey` index into the i18n bundle's
 *  `agents.messaging_picker.{field_labels,field_placeholders}` records. */
type DestFieldKey = "channel" | "chat_id" | "channel_id" | "team_id" | "to";

interface DestinationFieldDef {
  key: string;
  labelKey: DestFieldKey;
  placeholderKey: DestFieldKey;
}

const DESTINATION_FIELDS: Record<ChannelSpecV2Type, DestinationFieldDef[]> = {
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

/** Always-on built-in inbox row (cannot be deselected). */
const BUILT_IN_INBOX: ChannelSpecV2 = {
  type: "built-in",
  enabled: true,
  credential_id: null,
  use_case_ids: "*",
  event_filter: null,
  config: null,
};

interface PickableChannel {
  /** Stable key: `<channel_type>:<credential_id>` */
  key: string;
  channelType: ChannelSpecV2Type;
  credentialId: string;
  connector: HealthyConnector;
}

function getConfigValue(spec: ChannelSpecV2, key: string): string {
  const cfg = spec.config as Record<string, unknown> | null;
  if (!cfg) return "";
  const v = cfg[key];
  return typeof v === "string" ? v : "";
}

function setConfigValue(
  spec: ChannelSpecV2,
  key: string,
  value: string,
): ChannelSpecV2 {
  const cfg = (spec.config as Record<string, JsonValue> | null) ?? {};
  const next: Record<string, JsonValue> = { ...cfg };
  if (value.trim() === "") {
    delete next[key];
  } else {
    next[key] = value.trim();
  }
  // Cast: JsonValue's object variant uses optional values
  // (`{[k in string]?: JsonValue}`); our Record produces required values,
  // which is structurally compatible at runtime — TS just needs the hint.
  return {
    ...spec,
    config: Object.keys(next).length > 0 ? (next as JsonValue) : null,
  };
}

/**
 * Whether the spec is fully configured for delivery: every required
 * destination field has a non-empty value. Empty config means the
 * dispatcher will rely on the credential's scoped_resources fallback,
 * which may or may not be populated — we surface that as "incomplete"
 * so the user sees the warning during build instead of at delivery time.
 */
function isFullyConfigured(spec: ChannelSpecV2): boolean {
  const fields = DESTINATION_FIELDS[spec.type] ?? [];
  if (fields.length === 0) return true;
  return fields.every((f) => getConfigValue(spec, f.key).length > 0);
}

export function ComposerMessagingPickerModal({
  open,
  onClose,
  selected,
  onApply,
  solid = false,
}: ComposerMessagingPickerModalProps) {
  const { t } = useTranslation();
  const healthy = useHealthyConnectors();
  const [draft, setDraft] = useState<ChannelSpecV2[]>(selected);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const hasBuiltIn = selected.some((s) => s.type === "built-in");
    setDraft(hasBuiltIn ? selected : [BUILT_IN_INBOX, ...selected]);
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, selected]);

  /** Healthy messaging-category credentials with a known channel-type adapter. */
  const pickable: PickableChannel[] = useMemo(() => {
    return healthy
      .filter((c) => c.category === "messaging" || c.category === "email")
      .map((c) => {
        const channelType = serviceTypeToChannelType(c.name);
        if (!channelType) return null;
        return {
          key: `${channelType}:${c.credentialId}`,
          channelType,
          credentialId: c.credentialId,
          connector: c,
        };
      })
      .filter((x): x is PickableChannel => x !== null);
  }, [healthy]);

  const isSelected = (p: PickableChannel) =>
    draft.some(
      (s) => s.type === p.channelType && s.credential_id === p.credentialId,
    );

  const toggle = (p: PickableChannel) => {
    setDraft((prev) => {
      const idx = prev.findIndex(
        (s) => s.type === p.channelType && s.credential_id === p.credentialId,
      );
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [
        ...prev,
        {
          type: p.channelType,
          enabled: true,
          credential_id: p.credentialId,
          use_case_ids: "*",
          event_filter: null,
          config: null,
        },
      ];
    });
  };

  const updateDestination = (
    channelType: ChannelSpecV2Type,
    credentialId: string,
    fieldKey: string,
    value: string,
  ) => {
    setDraft((prev) =>
      prev.map((s) =>
        s.type === channelType && s.credential_id === credentialId
          ? setConfigValue(s, fieldKey, value)
          : s,
      ),
    );
  };

  const applyNow = () => onApply(draft);

  const externalSpecs = draft.filter(
    (s) => s.type !== "built-in" && s.type !== "titlebar",
  );
  const externalCount = externalSpecs.length;
  const incompleteCount = externalSpecs.filter((s) => !isFullyConfigured(s)).length;

  /** Lookup helpers for rendering selected specs with their connector metadata. */
  const pickableByKey = useMemo(() => {
    const map = new Map<string, PickableChannel>();
    for (const p of pickable) map.set(p.key, p);
    return map;
  }, [pickable]);

  const selectedRender = useMemo(
    () =>
      externalSpecs.map((spec) => {
        const key = `${spec.type}:${spec.credential_id ?? ""}`;
        return { key, spec, pick: pickableByKey.get(key) };
      }),
    [externalSpecs, pickableByKey],
  );

  const unselectedPickables = useMemo(
    () => pickable.filter((p) => !isSelected(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickable, draft],
  );

  return (
    <ComposerPickerShell
      open={open}
      onClose={onClose}
      onApply={applyNow}
      title={t.agents.messaging_picker.title}
      subtitle={
        externalCount === 0
          ? t.agents.messaging_picker.subtitle_inbox_only
          : t.agents.messaging_picker.subtitle_with_count.replace(
              "{count}",
              String(externalCount),
            )
      }
      icon={<MessageSquare className="w-5 h-5" />}
      size="lg"
      solid={solid}
      footer={
        <>
          <kbd className="typo-caption text-foreground"><DebtText k="auto_enter_b0d98854" /></kbd>
          <button
            type="button"
            onClick={applyNow}
            className="px-4 py-1.5 rounded-interactive bg-primary/30 hover:bg-primary/50 border border-primary/50 text-foreground typo-body font-medium transition-colors"
            style={{ boxShadow: "0 0 20px rgba(96,165,250,0.25)" }}
          >
            {externalCount === 0
              ? t.agents.messaging_picker.apply_inbox_only
              : t.agents.messaging_picker.apply_with_count.replace(
                  "{count}",
                  String(externalCount),
                )}
          </button>
        </>
      }
    >
      <div className="p-5 flex flex-col gap-4">
        {/* Pinned built-in inbox row */}
        <div className="rounded-card border border-primary/40 bg-primary/[0.06] p-3 flex items-center gap-3">
          <div className="shrink-0 w-10 h-10 rounded-interactive bg-primary/20 flex items-center justify-center text-primary">
            <Inbox className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="typo-body text-foreground font-medium">
              {t.agents.messaging_picker.builtin_label}
            </div>
            <div className="typo-caption text-foreground">
              {t.agents.messaging_picker.builtin_help}
            </div>
          </div>
          <span
            className="shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
            style={{ boxShadow: "0 0 10px rgba(96,165,250,0.8)" }}
            aria-label={t.agents.messaging_picker.builtin_always_on}
          >
            <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
          </span>
        </div>

        {/* Configured-channels section (selected + destination inputs). */}
        {selectedRender.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="typo-label text-foreground">
                {t.agents.messaging_picker.section_configured}
              </div>
              {incompleteCount > 0 && (
                <span className="inline-flex items-center gap-1 typo-caption text-amber-400/90">
                  <AlertCircle className="w-3 h-3" />
                  {t.agents.messaging_picker.incomplete_warning.replace(
                    "{count}",
                    String(incompleteCount),
                  )}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {selectedRender.map(({ key, spec, pick }) => {
                if (!pick) return null; // credential vanished from vault
                const meta = pick.connector.meta;
                const fields = DESTINATION_FIELDS[spec.type] ?? [];
                const complete = isFullyConfigured(spec);
                return (
                  <div
                    key={key}
                    className={`rounded-card border bg-foreground/[0.02] p-3 flex flex-col gap-3 ${
                      complete
                        ? "border-primary/40"
                        : "border-amber-400/40"
                    }`}
                    style={
                      complete
                        ? { boxShadow: `0 0 18px ${meta.color}33` }
                        : undefined
                    }
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="shrink-0 w-9 h-9 rounded-interactive flex items-center justify-center overflow-hidden"
                        style={{ background: `${meta.color}26` }}
                      >
                        {meta.iconUrl ? (
                          <ComposerBrandIcon
                            iconUrl={meta.iconUrl}
                            color={meta.color}
                            size={20}
                          />
                        ) : (
                          <Plug
                            className="w-4 h-4"
                            style={{ color: meta.color }}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="typo-body text-foreground font-medium truncate">
                          {meta.label}
                        </div>
                        <div className="typo-caption text-foreground truncate">
                          {spec.type}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle(pick)}
                        aria-label={t.agents.messaging_picker.remove_chip.replace(
                          "{name}",
                          meta.label,
                        )}
                        className="shrink-0 text-foreground hover:text-foreground p-1.5 rounded-interactive hover:bg-foreground/10"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {fields.length > 0 && (
                      <div
                        className={`grid gap-2 ${
                          fields.length > 1 ? "grid-cols-2" : "grid-cols-1"
                        }`}
                      >
                        {fields.map((field) => {
                          const value = getConfigValue(spec, field.key);
                          return (
                            <label
                              key={field.key}
                              className="flex flex-col gap-1"
                            >
                              <span className="typo-caption text-foreground">
                                {
                                  t.agents.messaging_picker.field_labels[
                                    field.labelKey
                                  ]
                                }
                              </span>
                              <input
                                type="text"
                                value={value}
                                onChange={(e) =>
                                  updateDestination(
                                    spec.type,
                                    spec.credential_id ?? "",
                                    field.key,
                                    e.target.value,
                                  )
                                }
                                placeholder={
                                  t.agents.messaging_picker.field_placeholders[
                                    field.placeholderKey
                                  ]
                                }
                                className="px-2.5 py-1.5 rounded-interactive border border-border/30 bg-foreground/[0.04] typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/50 transition-colors"
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {spec.type === 'discord' && (
                      <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={(() => {
                            const cfg = spec.config as Record<string, unknown> | null;
                            return cfg?.pollInbound === true;
                          })()}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setDraft((prev) =>
                              prev.map((s) => {
                                if (s !== spec) return s;
                                const cfg = (s.config as Record<string, JsonValue> | null) ?? {};
                                const merged: Record<string, JsonValue> = { ...cfg };
                                if (next) {
                                  merged.pollInbound = true;
                                } else {
                                  delete merged.pollInbound;
                                }
                                return {
                                  ...s,
                                  config: Object.keys(merged).length > 0 ? (merged as JsonValue) : null,
                                };
                              }),
                            );
                          }}
                          className="mt-0.5 accent-primary"
                          data-testid={`discord-poll-inbound-${spec.credential_id ?? ''}`}
                        />
                        <span className="typo-caption text-foreground">
                          <span className="font-medium text-foreground/90">{t.agents.messaging_picker.discord_poll_inbound_label}</span>
                          <span className="block text-foreground">{t.agents.messaging_picker.discord_poll_inbound_help}</span>
                        </span>
                      </label>
                    )}
                    {!complete && (
                      <p className="typo-caption text-amber-400/80">
                        {t.agents.messaging_picker.fallback_hint}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Available (unselected) channels grid */}
        {pickable.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-foreground/5 flex items-center justify-center">
              <Plug className="w-6 h-6 text-foreground" />
            </div>
            <div className="typo-body text-foreground/85">
              {t.agents.messaging_picker.empty_title}
            </div>
            <p className="typo-caption text-foreground max-w-xs">
              {t.agents.messaging_picker.empty_help}
            </p>
          </div>
        ) : unselectedPickables.length > 0 ? (
          <>
            <div className="typo-label text-foreground">
              {selectedRender.length > 0
                ? t.agents.messaging_picker.section_available
                : t.agents.messaging_picker.section_external}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {unselectedPickables.map((p) => {
                const meta = p.connector.meta;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => toggle(p)}
                    className="group relative flex items-center gap-3 p-3 rounded-card border transition-all text-left border-border/25 bg-foreground/[0.02] hover:border-primary/35 hover:bg-primary/[0.04]"
                  >
                    <div
                      className="shrink-0 w-10 h-10 rounded-interactive flex items-center justify-center overflow-hidden"
                      style={{ background: `${meta.color}26` }}
                    >
                      {meta.iconUrl ? (
                        <ComposerBrandIcon
                          iconUrl={meta.iconUrl}
                          color={meta.color}
                          size={22}
                        />
                      ) : (
                        <Plug className="w-5 h-5" style={{ color: meta.color }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="typo-body text-foreground font-medium truncate">
                        {meta.label}
                      </div>
                      <div className="typo-caption text-foreground truncate">
                        {p.channelType}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="typo-caption text-foreground">
              {t.agents.messaging_picker.fanout_help}
            </p>
          </>
        ) : null}
      </div>
    </ComposerPickerShell>
  );
}
