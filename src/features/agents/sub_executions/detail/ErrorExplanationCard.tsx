import { useCallback } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';
import { sanitizeErrorForDisplay } from '@/lib/utils/sanitizers/sanitizeErrorForDisplay';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import {
  type ErrorAction,
  SEVERITY_ICONS,
  SEVERITY_TO_TOKEN,
} from './executionDetailTypes';
import { classifyErrorFull } from '@/lib/errors/errorPipeline';

interface ErrorExplanationCardProps {
  errorMessage: string;
  showRaw: boolean;
  personaId: string | null;
}

export function ErrorExplanationCard({ errorMessage, showRaw, personaId }: ErrorExplanationCardProps) {
  const { t } = useTranslation();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const selectPersona = useAgentStore((s) => s.selectPersona);

  const handleErrorAction = useCallback((action: ErrorAction) => {
    switch (action.navigate) {
      case 'vault':
        setSidebarSection('credentials');
        break;
      case 'triggers':
        setSidebarSection('events');
        break;
      case 'persona-settings':
        if (personaId) {
          selectPersona(personaId);
          setEditorTab('settings');
        }
        break;
    }
  }, [personaId, setSidebarSection, setEditorTab, selectPersona]);

  const errorDisplay = showRaw ? errorMessage : sanitizeErrorForDisplay(errorMessage, 'error-explanation');
  const classified = classifyErrorFull(errorMessage);
  const explanation = classified.explanation;

  return (
    <div className="space-y-2">
      {explanation && (() => {
        const sevToken = SEVERITY_STYLES[SEVERITY_TO_TOKEN[explanation.severity]];
        const sevIcon = SEVERITY_ICONS[explanation.severity];
        const SeverityIcon = sevIcon.icon;
        return (
          <div
            className={`${sevToken.border} rounded-lg ${sevToken.bg} p-3.5`}
            data-testid="error-explanation-card"
            data-severity={explanation.severity}
          >
            <div className="flex items-start gap-2.5">
              <SeverityIcon className={`w-4 h-4 ${sevIcon.iconColor} mt-0.5 flex-shrink-0`} data-testid="error-severity-icon" />
              <div className="flex-1 min-w-0">
                <p className="typo-heading text-foreground/90">{explanation.summary}</p>
                <p className="typo-body text-muted-foreground/70 mt-1">{explanation.guidance}</p>
                {explanation.action && (() => {
                  const ActionIcon = explanation.action.icon;
                  return (
                    <Button
                      onClick={() => handleErrorAction(explanation.action!)}
                      data-testid="error-action-btn"
                      variant="primary"
                      size="sm"
                      icon={<ActionIcon className="w-3.5 h-3.5" />}
                      className="mt-2.5 group"
                    >
                      {explanation.action.label}
                      <ArrowRight className="w-3 h-3 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                    </Button>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}
      <div className={`p-4 ${SEVERITY_STYLES.error.border} ${SEVERITY_STYLES.error.bg} rounded-xl`}>
        <div className="flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="typo-code font-medium text-red-400 mb-1.5 uppercase tracking-wider">{t.agents.executions.error_label}</div>
            <pre className="typo-code text-red-300/80 whitespace-pre-wrap break-words">
              {errorDisplay}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
