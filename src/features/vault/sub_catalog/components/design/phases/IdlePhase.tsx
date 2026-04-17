import { Sparkles, Bot, Import, Globe } from 'lucide-react';
import { QUICK_SERVICE_HINTS, HINT_COLORS } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';
import type { ConnectorDefinition } from '@/lib/types/types';
import { IdleSuggestions } from './IdleSuggestions';
import { useTranslation } from '@/i18n/useTranslation';

interface IdlePhaseProps {
  instruction: string;
  onInstructionChange: (value: string) => void;
  onStart: () => void;
  onAutoSetup?: () => void;
  onImportFrom?: () => void;
  onUniversalSetup?: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  showTemplates: boolean;
  onToggleTemplates: () => void;
  templateSearch: string;
  onTemplateSearchChange: (value: string) => void;
  templateConnectors: ConnectorDefinition[];
  expandedTemplateId: string | null;
  onExpandTemplate: (id: string | null) => void;
  onApplyTemplate: (connectorName: string) => void | Promise<void>;
}

export function IdlePhase({
  instruction,
  onInstructionChange,
  onStart,
  onAutoSetup,
  onImportFrom,
  onUniversalSetup,
  onKeyDown,
  showTemplates,
  onToggleTemplates,
  templateSearch,
  onTemplateSearchChange,
  templateConnectors,
  expandedTemplateId,
  onExpandTemplate,
  onApplyTemplate,
}: IdlePhaseProps) {
  const { t } = useTranslation();
  return (
    <div
      key="input"
      className="animate-fade-slide-in space-y-4"
    >
      <div className="typo-body text-foreground">
        {t.vault.design_phases.idle_description}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onToggleTemplates}
          className="px-2.5 py-1 typo-body rounded-modal border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
        >
          {t.vault.design_phases.from_catalog}
        </button>

        {onUniversalSetup && (
          <button
            onClick={onUniversalSetup}
            className="flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-modal border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/10 transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
            {t.vault.design_phases.any_service}
          </button>
        )}

        {onImportFrom && (
          <button
            onClick={onImportFrom}
            className="flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-modal border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
          >
            <Import className="w-3.5 h-3.5" />
            {t.vault.design_phases.import_from}
          </button>
        )}

        {QUICK_SERVICE_HINTS.map((hint) => (
          <button
            key={hint}
            onClick={() => onInstructionChange(hint)}
            className="flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-modal border border-primary/15 text-foreground/85 hover:bg-secondary/60 transition-colors"
            data-testid={`hint-chip-${hint.split(' ')[0]?.toLowerCase()}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: HINT_COLORS[hint] ?? '#888' }}
            />
            {hint}
          </button>
        ))}
      </div>

      {showTemplates && (
        <IdleSuggestions
          templateSearch={templateSearch}
          onTemplateSearchChange={onTemplateSearchChange}
          templateConnectors={templateConnectors}
          expandedTemplateId={expandedTemplateId}
          onExpandTemplate={onExpandTemplate}
          onApplyTemplate={onApplyTemplate}
        />
      )}

      <textarea
        value={instruction}
        onChange={(e) => onInstructionChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t.vault.design_phases.instruction_placeholder}
        rows={3}
        autoFocus
        data-testid="vault-design-input"
        className="w-full px-4 py-3 bg-secondary/40 border border-primary/15 rounded-modal text-foreground typo-body placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all resize-none"
      />
      <div className="flex justify-end gap-2.5">
        {onAutoSetup && (
          <button
            onClick={onAutoSetup}
            disabled={!instruction.trim()}
            className="flex items-center gap-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-modal typo-body font-medium transition-all shadow-elevation-3 shadow-cyan-600/20"
          >
            <Bot className="w-4 h-4" />
            {t.vault.design_phases.auto_setup}
          </button>
        )}
        <button
          onClick={onStart}
          disabled={!instruction.trim()}
          data-testid="vault-design-submit"
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-foreground rounded-modal typo-body font-medium transition-all shadow-elevation-3 shadow-primary/20"
        >
          <Sparkles className="w-4 h-4" />
          {t.vault.design_phases.design_credential}
        </button>
      </div>
    </div>
  );
}
