import { X, Wrench } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import { useTranslation } from '@/i18n/useTranslation';
import { ToolRunnerPanel } from './ToolRunnerPanel';

interface ToolRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  tools: PersonaToolDefinition[];
  personaId: string | undefined;
}

/**
 * Modal host for the tool-runner panel. Reachable from the Use Cases tab's
 * "Run tool" affordance, it lets a user invoke any of the persona's assigned
 * tools directly (no LLM orchestration) against the persona's real credentials
 * via `invoke_tool_direct`. Keeps PersonaLayoutView thin — the whole panel +
 * chrome lives here.
 */
export function ToolRunnerModal({ isOpen, onClose, tools, personaId }: ToolRunnerModalProps) {
  const { t } = useTranslation();

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="tool-runner-modal"
      maxWidthClass="max-w-2xl"
      portal
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden max-h-[80vh]"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-primary/10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Wrench className="w-4 h-4 text-foreground shrink-0" />
            <div className="min-w-0">
              <h3
                id="tool-runner-modal"
                className="typo-heading font-semibold text-foreground uppercase tracking-wider"
              >
                {t.agents.tool_runner.panel_title}
              </h3>
              <p className="typo-body text-foreground/70">{t.agents.tool_runner.panel_subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-foreground transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 overflow-y-auto">
        <ToolRunnerPanel tools={tools} personaId={personaId} />
      </div>
    </BaseModal>
  );
}
