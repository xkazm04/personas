import { Sparkles, Bot, Import, Globe } from 'lucide-react';
import { QUICK_SERVICE_HINTS, HINT_COLORS } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';
import type { ConnectorDefinition } from '@/lib/types/types';
import { IdleSuggestions } from './IdleSuggestions';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

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
        <Button
          type="button"
          onClick={onToggleTemplates}
          variant="secondary"
          size="xs"
        >
          {t.vault.design_phases.from_catalog}
        </Button>

        {onUniversalSetup && (
          <Button
            type="button"
            onClick={onUniversalSetup}
            variant="secondary"
            size="xs"
            icon={<Globe className="w-3.5 h-3.5" />}
          >
            {t.vault.design_phases.any_service}
          </Button>
        )}

        {onImportFrom && (
          <Button
            type="button"
            onClick={onImportFrom}
            variant="accent"
            tone="highlight"
            size="xs"
            icon={<Import className="w-3.5 h-3.5" />}
          >
            {t.vault.design_phases.import_from}
          </Button>
        )}

        {QUICK_SERVICE_HINTS.map((hint) => (
          <Button
            key={hint}
            type="button"
            onClick={() => onInstructionChange(hint)}
            variant="secondary"
            size="xs"
            data-testid={`hint-chip-${hint.split(' ')[0]?.toLowerCase()}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: HINT_COLORS[hint] ?? '#888' }}
            />
            {hint}
          </Button>
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
        className="w-full px-4 py-3 bg-surface-2 border border-hair rounded-modal text-foreground typo-body placeholder:text-ink-3 focus-ring focus-visible:border-primary/40 transition-all resize-none"
      />
      <div className="flex justify-end gap-2.5">
        {onAutoSetup && (
          <Button
            type="button"
            onClick={onAutoSetup}
            disabled={!instruction.trim()}
            variant="accent"
            tone="highlight"
            size="md"
            icon={<Bot className="w-4 h-4" />}
          >
            {t.vault.design_phases.auto_setup}
          </Button>
        )}
        <Button
          type="button"
          onClick={onStart}
          disabled={!instruction.trim()}
          data-testid="vault-design-submit"
          variant="primary"
          size="md"
          icon={<Sparkles className="w-4 h-4" />}
        >
          {t.vault.design_phases.design_credential}
        </Button>
      </div>
    </div>
  );
}
