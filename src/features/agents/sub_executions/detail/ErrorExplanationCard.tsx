import { useCallback } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';
import { sanitizeErrorMessage } from '@/lib/utils/sanitizers/maskSensitive';
import { usePersonaStore } from '@/stores/personaStore';
import {
  type ErrorAction,
  SEVERITY_ICONS,
  SEVERITY_TO_TOKEN,
  getErrorExplanation,
} from './executionDetailTypes';

interface ErrorExplanationCardProps {
  errorMessage: string;
  showRaw: boolean;
  personaId: string | null;
}

export function ErrorExplanationCard({ errorMessage, showRaw, personaId }: ErrorExplanationCardProps) {
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const selectPersona = usePersonaStore((s) => s.selectPersona);

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

  const errorDisplay = showRaw ? errorMessage : sanitizeErrorMessage(errorMessage);
  const explanation = getErrorExplanation(errorMessage);

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
                <p className="text-sm font-medium text-foreground/90">{explanation.summary}</p>
                <p className="text-sm text-muted-foreground/70 mt-1">{explanation.guidance}</p>
                {explanation.action && (() => {
                  const ActionIcon = explanation.action.icon;
                  return (
                    <button
                      onClick={() => handleErrorAction(explanation.action!)}
                      data-testid="error-action-btn"
                      className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-primary/10 text-primary/80 border border-primary/15 hover:bg-primary/20 hover:text-primary transition-all group"
                    >
                      <ActionIcon className="w-3.5 h-3.5" />
                      {explanation.action.label}
                      <ArrowRight className="w-3 h-3 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                    </button>
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
            <div className="text-sm font-mono font-medium text-red-400 mb-1.5 uppercase tracking-wider">Error</div>
            <pre className="text-sm text-red-300/80 whitespace-pre-wrap break-words font-mono">
              {errorDisplay}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
