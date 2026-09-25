import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BookOpen, Settings, Code, Sparkles, CircleAlert } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { DraftPromptTab } from './DraftPromptTab';
import { DraftSettingsTab } from './DraftSettingsTab';
import { DraftJsonTab } from './DraftJsonTab';
import { useTranslation } from '@/i18n/useTranslation';
import { useVaultStore } from '@/stores/vaultStore';
import { silentCatch } from '@/lib/silentCatch';
import { deriveDraftCompleteness, type DraftRequirementId } from './draftCompleteness';

export interface DraftEditTab {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  content: React.ReactNode;
  /** Optional badge element rendered after the label (e.g., notification dot) */
  badge?: React.ReactNode;
}

type BuiltinTabId = 'prompt' | 'settings' | 'json';

interface DraftEditStepProps {
  draft: N8nPersonaDraft;
  draftJson: string;
  draftJsonError: string | null;
  adjustmentRequest: string;
  transforming: boolean;
  disabled: boolean;
  updateDraft: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
  onDraftUpdated: (draft: N8nPersonaDraft) => void;
  onJsonEdited: (json: string, draft: N8nPersonaDraft | null, error: string | null) => void;
  onAdjustmentChange: (text: string) => void;
  onApplyAdjustment: () => void;
  /** Tabs inserted before Prompt tab */
  earlyTabs?: DraftEditTab[];
  /** Additional tabs inserted after Settings, before JSON tab */
  additionalTabs?: DraftEditTab[];
  /** Hide the bottom adjustment panel (when it's rendered in a dedicated tab instead) */
  hideAdjustmentPanel?: boolean;
  /** Show notification channels in the Settings tab */
  showNotifications?: boolean;
  /** Reports which required fields are still missing, so the host can gate Save. */
  onCompletenessChange?: (missing: DraftRequirementId[]) => void;
}

const BUILTIN_TABS: { id: BuiltinTabId; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'prompt', label: 'Prompt', Icon: BookOpen },
  { id: 'settings', label: 'Settings', Icon: Settings },
  // JSON tab added last, after any additional tabs
];

const JSON_TAB = { id: 'json' as const, label: 'JSON', Icon: Code };

export function DraftEditStep({
  draft,
  draftJson,
  draftJsonError,
  adjustmentRequest,
  transforming,
  disabled,
  updateDraft,
  onDraftUpdated,
  onJsonEdited,
  onAdjustmentChange,
  onApplyAdjustment,
  earlyTabs = [],
  additionalTabs = [],
  hideAdjustmentPanel = false,
  showNotifications,
  onCompletenessChange,
}: DraftEditStepProps) {
  const { t } = useTranslation();
  // The Prompt tab already tracked per-section content and painted a dot from
  // it; nothing aggregated that into a save gate, so a nameless, promptless
  // shell could land in the catalog. Derive it once and report it up.
  const completeness = deriveDraftCompleteness(draft);
  const missingKey = completeness.missing.join(',');
  useEffect(() => {
    onCompletenessChange?.(missingKey ? (missingKey.split(',') as DraftRequirementId[]) : []);
  }, [missingKey, onCompletenessChange]);
  const requirementLabel = (id: DraftRequirementId) =>
    id === 'name' ? t.shared.draft_editor.name_label : t.shared.draft_editor.requirement_identity;
  const defaultTab = earlyTabs.length > 0 ? earlyTabs[0]!.id : 'prompt';
  const [activeTab, setActiveTab] = useState<string>(defaultTab);

  // The Settings tab's icon selector and notification-channel credential picker
  // both resolve against the vault; without these the picker is always empty.
  const { credentials, connectorDefinitions, fetchCredentials, fetchConnectorDefinitions } = useVaultStore(
    useShallow((s) => ({
      credentials: s.credentials,
      connectorDefinitions: s.connectorDefinitions,
      fetchCredentials: s.fetchCredentials,
      fetchConnectorDefinitions: s.fetchConnectorDefinitions,
    })),
  );
  useEffect(() => {
    void fetchCredentials().catch(silentCatch('DraftEditStep:fetchCredentials'));
  }, [fetchCredentials]);
  useEffect(() => {
    if (connectorDefinitions.length === 0) {
      void fetchConnectorDefinitions().catch(silentCatch('DraftEditStep:fetchConnectorDefinitions'));
    }
  }, [connectorDefinitions.length, fetchConnectorDefinitions]);

  // Build full tab list: earlyTabs + Prompt + Settings + additionalTabs + JSON
  const allTabs: { id: string; label: string; Icon: React.ComponentType<{ className?: string }>; badge?: React.ReactNode }[] = [
    ...earlyTabs.map((t) => ({ id: t.id, label: t.label, Icon: t.Icon, badge: t.badge })),
    ...BUILTIN_TABS,  // Prompt, Settings
    ...additionalTabs.map((t) => ({ id: t.id, label: t.label, Icon: t.Icon, badge: t.badge })),
    JSON_TAB,
  ];

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Editable persona header */}
      <div className="flex items-center gap-3 px-1 flex-shrink-0">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center typo-body border flex-shrink-0"
          style={{
            backgroundColor: `${draft.color ?? '#8b5cf6'}18`,
            borderColor: `${draft.color ?? '#8b5cf6'}30`,
          }}
        >
          {draft.icon ?? '\u2728'}
        </div>
        <div className="flex-1 min-w-0 space-y-0.5">
          <input
            type="text"
            value={draft.name ?? ''}
            onChange={(e) => updateDraft((curr) => ({ ...curr, name: e.target.value || null }))}
            onBlur={(e) => {
              const trimmed = e.target.value.trim();
              if (trimmed !== e.target.value) {
                updateDraft((curr) => ({ ...curr, name: trimmed || null }));
              }
            }}
            placeholder={t.shared.draft_editor.persona_name_placeholder}
            disabled={disabled}
            className="w-full typo-heading text-foreground bg-transparent border-none outline-none placeholder-muted-foreground/30 p-0"
          />
          <input
            type="text"
            value={draft.description ?? ''}
            onChange={(e) => updateDraft((curr) => ({ ...curr, description: e.target.value.trim() ? e.target.value : null }))}
            placeholder={t.shared.draft_editor.description_placeholder}
            disabled={disabled}
            className="w-full typo-body text-foreground bg-transparent border-none outline-none placeholder-muted-foreground/30 p-0"
          />
        </div>
      </div>

      {completeness.missing.length > 0 && (
        <div
          id="draft-completeness-checklist"
          data-testid="draft-completeness-checklist"
          className="flex items-center gap-2 px-1 flex-shrink-0 flex-wrap"
        >
          <CircleAlert className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
          <span className="typo-caption text-foreground uppercase tracking-wider">
            {t.shared.draft_editor.incomplete_label}
          </span>
          {completeness.missing.map((id) => (
            <span
              key={id}
              data-testid={`draft-missing-${id}`}
              className="inline-flex items-center px-2 py-0.5 typo-caption rounded-card border border-amber-500/25 bg-amber-500/10 text-amber-200"
            >
              {requirementLabel(id)}
            </span>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 flex-shrink-0" role="tablist" aria-label={t.shared.draft_editor.edit_tabs_label}>
        {allTabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            id={`draft-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`draft-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`flex items-center gap-1.5 px-3.5 py-2 typo-heading rounded-xl border transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
                : 'bg-secondary/20 border-primary/10 text-foreground hover:border-primary/20 hover:text-muted-foreground'
            }`}
          >
            <tab.Icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.badge}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
            key={activeTab}
            role="tabpanel"
            id={`draft-panel-${activeTab}`}
            aria-labelledby={`draft-tab-${activeTab}`}
            className="animate-fade-slide-in h-full"
          >
          {activeTab === 'prompt' && (
            <DraftPromptTab draft={draft} disabled={disabled} updateDraft={updateDraft} />
          )}

          {activeTab === 'settings' && (
            <DraftSettingsTab
              draft={draft}
              disabled={disabled}
              updateDraft={updateDraft}
              connectors={connectorDefinitions}
              credentials={credentials}
              showNotifications={showNotifications}
            />
          )}

          {/* Render early tabs (before Prompt) */}
          {earlyTabs.map((tab) =>
            activeTab === tab.id ? (
              <div key={tab.id} className="h-full">{tab.content}</div>
            ) : null,
          )}

          {/* Render additional tabs (after Settings) */}
          {additionalTabs.map((tab) =>
            activeTab === tab.id ? (
              <div key={tab.id} className="h-full">{tab.content}</div>
            ) : null,
          )}

          {activeTab === 'json' && (
            <DraftJsonTab
              draftJson={draftJson}
              draftJsonError={draftJsonError}
              disabled={disabled}
              onJsonChange={(json, parsedDraft, error) => {
                if (parsedDraft) {
                  onDraftUpdated(parsedDraft);
                }
                onJsonEdited(json, parsedDraft, error);
              }}
            />
          )}
          </div>
      </div>

      {/* Adjustment request panel (hidden when a dedicated tab handles it) */}
      {!hideAdjustmentPanel && (
        <div className="border-t border-primary/10 pt-4 space-y-2 flex-shrink-0">
          <label className="typo-heading text-foreground uppercase flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            {t.shared.draft_editor.request_ai_adjustments}
          </label>
          <div className="flex gap-2">
            <textarea
              value={adjustmentRequest}
              onChange={(e) => onAdjustmentChange(e.target.value)}
              placeholder={t.shared.draft_editor.refine_placeholder}
              className="flex-1 h-16 p-2.5 rounded-xl border border-primary/15 bg-background/40 typo-body text-foreground resize-none placeholder-muted-foreground/30"
              disabled={disabled || transforming}
            />
            <button
              type="button"
              onClick={onApplyAdjustment}
              disabled={disabled || transforming || !adjustmentRequest.trim()}
              className="self-end px-4 py-2 typo-heading rounded-xl border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
