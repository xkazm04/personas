import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, BookOpen, Settings, Code, Sparkles } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/design';
import { DraftIdentityTab } from './DraftIdentityTab';
import { DraftPromptTab } from './DraftPromptTab';
import { DraftSettingsTab } from './DraftSettingsTab';
import { DraftJsonTab } from './DraftJsonTab';

export interface DraftEditTab {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  content: React.ReactNode;
}

type BuiltinTabId = 'identity' | 'prompt' | 'settings' | 'json';

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
  /** Additional tabs inserted before JSON tab */
  additionalTabs?: DraftEditTab[];
}

const BUILTIN_TABS: { id: BuiltinTabId; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'identity', label: 'Identity', Icon: User },
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
  additionalTabs = [],
}: DraftEditStepProps) {
  const [activeTab, setActiveTab] = useState<string>('identity');

  // Build full tab list: builtin + additional + json
  const allTabs: { id: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    ...BUILTIN_TABS,
    ...additionalTabs.map((t) => ({ id: t.id, label: t.label, Icon: t.Icon })),
    JSON_TAB,
  ];

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Persona quick preview */}
      <div className="flex items-center gap-3 px-1 flex-shrink-0">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-sm border flex-shrink-0"
          style={{
            backgroundColor: `${draft.color ?? '#8b5cf6'}18`,
            borderColor: `${draft.color ?? '#8b5cf6'}30`,
          }}
        >
          {draft.icon ?? '\u2728'}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground/80 truncate">
            {draft.name || 'Unnamed Persona'}
          </p>
          <p className="text-[11px] text-muted-foreground/40 truncate">
            {draft.description || 'Edit the details below'}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 flex-shrink-0">
        {allTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl border transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
                : 'bg-secondary/20 border-primary/10 text-muted-foreground/40 hover:border-primary/20 hover:text-muted-foreground/60'
            }`}
          >
            <tab.Icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="h-full"
          >
          {activeTab === 'identity' && (
            <DraftIdentityTab draft={draft} disabled={disabled} updateDraft={updateDraft} />
          )}

          {activeTab === 'prompt' && (
            <DraftPromptTab draft={draft} disabled={disabled} updateDraft={updateDraft} />
          )}

          {activeTab === 'settings' && (
            <DraftSettingsTab draft={draft} disabled={disabled} updateDraft={updateDraft} />
          )}

          {/* Render additional tabs */}
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
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Adjustment request panel */}
      <div className="border-t border-primary/10 pt-4 space-y-2 flex-shrink-0">
        <label className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          Request AI Adjustments
        </label>
        <div className="flex gap-2">
          <textarea
            value={adjustmentRequest}
            onChange={(e) => onAdjustmentChange(e.target.value)}
            placeholder="Example: Make error handling stricter, add retry logic..."
            className="flex-1 h-16 p-2.5 rounded-xl border border-primary/15 bg-background/40 text-xs text-foreground/75 resize-none placeholder-muted-foreground/30"
            disabled={disabled || transforming}
          />
          <button
            onClick={onApplyAdjustment}
            disabled={disabled || transforming || !adjustmentRequest.trim()}
            className="self-end px-4 py-2 text-xs font-medium rounded-xl border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
