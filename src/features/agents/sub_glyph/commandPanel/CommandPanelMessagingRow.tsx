/**
 * CommandPanelMessagingRow — composer row for picking delivery channels.
 *
 * Mirrors CommandPanelToolsRow's shape (chips + free-text + attach button)
 * but the underlying state is `ChannelSpecV2[]` rather than a string list,
 * because each channel carries a credential ID and a kebab-case channel
 * type. The free-text input still drives the prompt's natural-language
 * "Output" intent — the structured channels are an additive layer that
 * Slice 3 will persist to `personas.notification_channels`.
 */
import { useMemo } from "react";
import { MessageSquare, X, Inbox, Plug, AlertCircle } from "lucide-react";
import { useHealthyConnectors } from "@/features/agents/shared/quickConfig/useHealthyConnectors";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import type { ChannelSpecV2Type } from "@/lib/bindings/ChannelSpecV2Type";
import { useTranslation } from "@/i18n/useTranslation";
import { CommandPanelRow, CommandPanelAttachButton } from "./CommandPanelRow";
import { ComposerBrandIcon } from "./composer/ComposerBrandIcon";
import type { IntentRowDef } from "./commandPanelHelpers";

/** Required destination keys per channel type — mirrors DESTINATION_FIELDS
 *  in ComposerMessagingPickerModal. Kept in sync there; the source of truth
 *  is the dispatcher's `deliver_*` adapters in `notifications.rs`. */
const REQUIRED_KEYS: Record<ChannelSpecV2Type, string[]> = {
  "built-in": [],
  titlebar: [],
  slack: ["channel"],
  telegram: ["chat_id"],
  discord: ["channel_id"],
  teams: ["team_id", "channel_id"],
  email: ["to"],
};

function isFullyConfigured(spec: ChannelSpecV2): boolean {
  const keys = REQUIRED_KEYS[spec.type] ?? [];
  if (keys.length === 0) return true;
  const cfg = spec.config as Record<string, unknown> | null;
  if (!cfg) return false;
  return keys.every((k) => {
    const v = cfg[k];
    return typeof v === "string" && v.trim().length > 0;
  });
}

interface CommandPanelMessagingRowProps {
  rowDef: IntentRowDef;
  draftValue: string;
  onChange: (v: string) => void;
  onKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => void;
  selectedChannels: ChannelSpecV2[];
  setSelectedChannels: React.Dispatch<React.SetStateAction<ChannelSpecV2[]>>;
  onOpenMessaging: () => void;
}

export function CommandPanelMessagingRow({
  rowDef,
  draftValue,
  onChange,
  onKeyDown,
  selectedChannels,
  setSelectedChannels,
  onOpenMessaging,
}: CommandPanelMessagingRowProps) {
  const { t } = useTranslation();
  const healthy = useHealthyConnectors();

  // Derive chip metadata from selected specs. The built-in row gets a
  // dedicated label/icon; external rows look up the credential's connector
  // for the brand color + icon URL. External rows also report whether
  // their destination is fully configured so a "needs setup" warning can
  // surface before launch.
  const chips = useMemo(
    () =>
      selectedChannels.map((spec) => {
        if (spec.type === "built-in" || spec.type === "titlebar") {
          return {
            key: `${spec.type}:${spec.credential_id ?? ""}`,
            label:
              spec.type === "built-in"
                ? t.agents.messaging_picker.builtin_label
                : t.agents.messaging_picker.titlebar_label,
            color: undefined,
            iconUrl: undefined,
            isBuiltIn: true,
            configured: true,
            spec,
          };
        }
        const cred = healthy.find((h) => h.credentialId === spec.credential_id);
        return {
          key: `${spec.type}:${spec.credential_id ?? ""}`,
          label: cred?.meta.label ?? spec.type,
          color: cred?.meta.color,
          iconUrl: cred?.meta.iconUrl,
          isBuiltIn: false,
          configured: isFullyConfigured(spec),
          spec,
        };
      }),
    [selectedChannels, healthy, t],
  );

  const externalCount = chips.filter((c) => !c.isBuiltIn).length;
  const needsSetupCount = chips.filter(
    (c) => !c.isBuiltIn && !c.configured,
  ).length;

  return (
    <CommandPanelRow icon={rowDef.icon} label={rowDef.label} alignTop>
      <div className="flex flex-col gap-2">
        {chips.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {chips.map((c) => (
              <span
                key={c.key}
                className={`flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full typo-caption text-foreground border ${
                  c.configured
                    ? "bg-primary/20 border-primary/40"
                    : "bg-amber-500/15 border-amber-400/50"
                }`}
                style={
                  c.color && c.configured
                    ? { boxShadow: `0 0 10px ${c.color}26` }
                    : undefined
                }
                title={
                  c.configured
                    ? undefined
                    : t.agents.messaging_picker.fallback_hint
                }
              >
                <span
                  className="inline-flex w-5 h-5 rounded-full items-center justify-center overflow-hidden shrink-0"
                  style={{ background: c.color ? `${c.color}26` : undefined }}
                >
                  {c.isBuiltIn ? (
                    <Inbox className="w-3 h-3" />
                  ) : c.iconUrl && c.color ? (
                    <ComposerBrandIcon
                      iconUrl={c.iconUrl}
                      color={c.color}
                      size={14}
                    />
                  ) : (
                    <Plug className="w-3 h-3" style={{ color: c.color }} />
                  )}
                </span>
                {c.label}
                {!c.configured && !c.isBuiltIn && (
                  <AlertCircle className="w-3 h-3 text-amber-400" />
                )}
                {!c.isBuiltIn && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedChannels((prev) =>
                        prev.filter(
                          (s) =>
                            !(
                              s.type === c.spec.type &&
                              s.credential_id === c.spec.credential_id
                            ),
                        ),
                      )
                    }
                    aria-label={t.agents.messaging_picker.remove_chip.replace(
                      "{name}",
                      c.label,
                    )}
                    className="text-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draftValue}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={rowDef.placeholder}
            data-testid="composer-row-messaging"
            className="flex-1 min-w-0 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none"
          />
          <CommandPanelAttachButton
            icon={MessageSquare}
            active={externalCount > 0}
            onClick={onOpenMessaging}
          >
            {externalCount === 0
              ? t.agents.messaging_picker.attach_inbox_only
              : needsSetupCount > 0
                ? t.agents.messaging_picker.attach_needs_setup.replace(
                    "{count}",
                    String(needsSetupCount),
                  )
                : t.agents.messaging_picker.attach_with_count.replace(
                    "{count}",
                    String(externalCount),
                  )}
          </CommandPanelAttachButton>
        </div>
      </div>
    </CommandPanelRow>
  );
}
