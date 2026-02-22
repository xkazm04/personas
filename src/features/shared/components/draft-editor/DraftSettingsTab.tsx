import { useMemo, useCallback } from 'react';
import type { N8nPersonaDraft } from '@/api/design';
import type { ModelProfile, NotificationChannel } from '@/lib/types/frontendTypes';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { profileToDropdownValue, getOllamaPreset, OLLAMA_CLOUD_BASE_URL } from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';
import { ModelSelector } from '@/features/agents/sub_editor/model-config/ModelSelector';
import { IconSelector } from '@/features/shared/components/IconSelector';
import { ColorPicker } from '@/features/shared/components/ColorPicker';
import { NotificationChannelSettings } from '@/features/agents/sub_editor/NotificationChannelSettings';

// ── model_profile ↔ dropdown value helpers ────────────────────────────

function modelProfileToDropdownValue(profileJson: string | null): string {
  if (!profileJson) return 'sonnet'; // default for n8n drafts
  try {
    const mp: ModelProfile = JSON.parse(profileJson);
    return profileToDropdownValue(mp);
  } catch {
    return 'sonnet';
  }
}

function dropdownValueToModelProfile(value: string): string | null {
  const ollamaPreset = getOllamaPreset(value);
  if (ollamaPreset) {
    return JSON.stringify({
      model: ollamaPreset.modelId,
      provider: 'ollama',
      base_url: OLLAMA_CLOUD_BASE_URL,
    } satisfies ModelProfile);
  }
  if (value === 'custom' || value === '') {
    return null; // opus = default (null), custom not supported in n8n draft
  }
  // Standard Anthropic model
  return JSON.stringify({
    model: value,
    provider: 'anthropic',
  } satisfies ModelProfile);
}

function parseChannels(json: string | null | undefined): NotificationChannel[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Component ─────────────────────────────────────────────────────────

interface DraftSettingsTabProps {
  draft: N8nPersonaDraft;
  disabled: boolean;
  updateDraft: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
  connectors?: ConnectorDefinition[];
  credentials?: CredentialMetadata[];
  /** Show notification channels section (self-managed from draft.notification_channels) */
  showNotifications?: boolean;
}

export function DraftSettingsTab({
  draft,
  disabled: _disabled,
  updateDraft,
  connectors = [],
  credentials = [],
  showNotifications,
}: DraftSettingsTabProps) {
  const selectedModel = modelProfileToDropdownValue(draft.model_profile ?? null);

  const notificationChannels = useMemo(
    () => parseChannels(draft.notification_channels),
    [draft.notification_channels],
  );

  const handleNotificationChannelsChange = useCallback(
    (channels: NotificationChannel[]) => {
      updateDraft((curr) => ({
        ...curr,
        notification_channels: channels.length > 0 ? JSON.stringify(channels) : null,
      }));
    },
    [updateDraft],
  );

  return (
    <div className="space-y-4 h-full overflow-y-auto pr-1">
      {/* Appearance */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          Appearance
        </h4>
        <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-2">Icon</label>
            <IconSelector
              value={draft.icon ?? ''}
              onChange={(icon) => updateDraft((curr) => ({ ...curr, icon: icon || null }))}
              connectors={connectors}
              size="sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-2">Color</label>
            <ColorPicker
              value={draft.color ?? '#8b5cf6'}
              onChange={(color) => updateDraft((curr) => ({ ...curr, color }))}
              size="sm"
            />
          </div>
        </div>
      </div>

      {/* Model & Provider */}
      <ModelSelector
        selectedModel={selectedModel}
        onSelectModel={(value) =>
          updateDraft((curr) => ({
            ...curr,
            model_profile: dropdownValueToModelProfile(value),
          }))
        }
        maxBudget={draft.max_budget_usd}
        maxTurns={draft.max_turns}
        onMaxBudgetChange={(v) =>
          updateDraft((curr) => ({
            ...curr,
            max_budget_usd: v === '' || v === null ? null : Number(v),
          }))
        }
        onMaxTurnsChange={(v) =>
          updateDraft((curr) => ({
            ...curr,
            max_turns: v === '' || v === null ? null : Number(v),
          }))
        }
      />

      {/* Notification Channels (opt-in, self-managed from draft.notification_channels) */}
      {showNotifications && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
            <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
            Notifications
          </h4>
          <NotificationChannelSettings
            credentials={credentials}
            connectorDefinitions={connectors}
            draftChannels={notificationChannels}
            onDraftChannelsChange={handleNotificationChannelsChange}
          />
        </div>
      )}
    </div>
  );
}
