import { ArrowRight, Sparkles, Check, RefreshCw } from 'lucide-react';

interface ConnectorInfo {
  activeName: string;
}

interface WizardState {
  step: string;
  selectedUseCaseIds: Set<string>;
  connectorCredentialMap: Record<string, string>;
  questionGenerating: boolean;
  backgroundAdoptId: string | null;
  questions: unknown;
  transforming: boolean;
  draft: unknown;
  created: boolean;
  confirming: boolean;
  safetyCriticalOverride: boolean;
}

interface SafetyScan {
  critical: unknown[];
}

export interface NextAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled: boolean;
  variant: 'violet' | 'emerald';
  spinning?: boolean;
}

export function getNextAction(
  state: WizardState,
  requiredConnectors: ConnectorInfo[],
  safetyScan: SafetyScan | null,
): NextAction | null {
  switch (state.step) {
    case 'choose':
      return { label: 'Next: Connect', icon: ArrowRight, disabled: state.selectedUseCaseIds.size === 0, variant: 'violet' };
    case 'connect': {
      const unconfigured = requiredConnectors.filter(
        (c) => c.activeName !== 'personas_messages' && c.activeName !== 'personas_database' && !state.connectorCredentialMap[c.activeName],
      ).length;
      return {
        label: unconfigured > 0 ? `Configure (${unconfigured} remaining)` : 'Next: Configure',
        icon: ArrowRight,
        disabled: unconfigured > 0,
        variant: 'violet',
      };
    }
    case 'tune':
      if (state.questionGenerating) {
        return { label: 'Analyzing...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true };
      }
      if (state.backgroundAdoptId && state.questions) {
        return { label: 'Continue with Answers', icon: ArrowRight, disabled: false, variant: 'violet' };
      }
      return { label: 'Build Persona', icon: Sparkles, disabled: false, variant: 'violet' };
    case 'build':
      return state.transforming
        ? { label: 'Generating...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true }
        : { label: 'Review Draft', icon: ArrowRight, disabled: !state.draft, variant: 'violet' };
    case 'create': {
      if (state.created) {
        return { label: 'Done', icon: Check, disabled: false, variant: 'emerald' };
      }
      const hasCriticalFindings = (safetyScan?.critical.length ?? 0) > 0;
      const criticalBlocked = hasCriticalFindings && !state.safetyCriticalOverride;
      return state.confirming
        ? { label: 'Creating...', icon: RefreshCw, disabled: true, variant: 'emerald', spinning: true }
        : {
            label: criticalBlocked ? 'Blocked by Safety Scan' : 'Create Persona',
            icon: Sparkles,
            disabled: !state.draft || criticalBlocked,
            variant: 'emerald',
          };
    }
    default:
      return null;
  }
}

export function getBackLabel(step: string, transforming: boolean): string {
  if (step === 'choose') return 'Cancel';
  if (step === 'build' && transforming) return 'Cancel Generation';
  return 'Back';
}
