import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { AlertCircle, X, Play } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { AnimatePresence, motion } from 'framer-motion';
import { PersonaAvatar } from '@/features/shared/components/display/PersonaAvatar';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useToastStore } from '@/stores/toastStore';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { LabQualityBadge } from '@/features/agents/sub_lab/components/shared/LabQualityBadge';
import { useParsedDesignContext } from '@/stores/selectors/personaSelectors';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { createLogger } from '@/lib/log';
import type { PersonaDraft } from '../libs/PersonaDraft';
import { useEffectivePersona } from '../libs/useEffectivePersona';
import { QuickStatsBar } from './QuickStatsBar';

const logger = createLogger('persona-editor-header');

interface PersonaEditorHeaderProps {
  draft: PersonaDraft;
  baseline: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  setBaseline: React.Dispatch<React.SetStateAction<PersonaDraft>>;
}

export function PersonaEditorHeader({ draft, baseline, patch, setBaseline }: PersonaEditorHeaderProps) {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const executePersonaAction = useAgentStore((s) => s.executePersona);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const executionPersonaId = useAgentStore((s) => s.executionPersonaId);
  const credentials = useVaultStore((s) => s.credentials);
  const effective = useEffectivePersona(draft, baseline);
  const designContext = useParsedDesignContext();
  const [showReadinessPopover, setShowReadinessPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Execute button state: running if this persona is the active execution
  const isThisPersonaExecuting = isExecuting && executionPersonaId === selectedPersona?.id;

  const handleExecute = useCallback(async () => {
    if (!selectedPersona?.id || isThisPersonaExecuting) return;
    try {
      await executePersonaAction(selectedPersona.id);
    } catch (err) {
      logger.error('Execute failed', { error: err instanceof Error ? err.message : String(err) });
      useToastStore.getState().addToast('Failed to start execution. Please try again.', 'error');
    }
  }, [selectedPersona?.id, isThisPersonaExecuting, executePersonaAction]);

  useClickOutside(popoverRef, showReadinessPopover, () => setShowReadinessPopover(false));

  useEffect(() => {
    if (!showReadinessPopover) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowReadinessPopover(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showReadinessPopover]);

  const triggers = selectedPersona?.triggers;
  const subscriptions = selectedPersona?.subscriptions;
  const tools = selectedPersona?.tools;

  const readiness = useMemo(() => {
    if (!selectedPersona) return { canEnable: false, reasons: [] as string[] };
    const reasons: string[] = [];
    if (!(triggers || []).length && !(subscriptions || []).length) {
      reasons.push('No triggers or event subscriptions configured');
    }
    const credTypes = new Set(credentials.map((c) => c.service_type));
    const missingCreds = (tools || [])
      .filter((t) => t.requires_credential_type && !credTypes.has(t.requires_credential_type))
      .map((t) => t.requires_credential_type!);
    const unique = [...new Set(missingCreds)];
    if (unique.length > 0) reasons.push(`Missing credentials: ${unique.join(', ')}`);
    return { canEnable: reasons.length === 0, reasons };
  }, [selectedPersona, triggers, subscriptions, tools, credentials]);

  const handleHeaderToggle = useCallback(async () => {
    if (!selectedPersona) return;
    const nextEnabled = !selectedPersona.enabled;
    if (nextEnabled && !readiness.canEnable) {
      setShowReadinessPopover(true);
      return;
    }
    try {
      await applyPersonaOp(selectedPersona.id, { kind: 'ToggleEnabled', enabled: nextEnabled });
      patch({ enabled: nextEnabled });
      setBaseline((prev) => ({ ...prev, enabled: nextEnabled }));
    } catch { useToastStore.getState().addToast('Could not update agent status. Please check your connection.', 'error'); }
  }, [selectedPersona, readiness, applyPersonaOp, patch, setBaseline]);

  if (!effective) return null;

  const personaIcon = (
    <PersonaAvatar icon={effective.icon} name={effective.name} color={effective.color} size="sm" />
  );

  return (
    <ContentHeader
      icon={personaIcon}
      title={effective.name}
      subtitle={
        <span className="flex items-center gap-2">
          {effective.description && <span>{effective.description}</span>}
          {import.meta.env.DEV && <LabQualityBadge testMetadata={designContext.labTestMetadata} compact />}
        </span>
      }
      actions={
        <div className="relative flex flex-col items-end gap-1.5 flex-shrink-0">
          {/* Execute button — top row, above the Active toggle */}
          <Button
            variant="accent"
            accentColor={isThisPersonaExecuting ? 'orange' : 'blue'}
            size="sm"
            icon={<Play className="w-3.5 h-3.5" />}
            loading={isThisPersonaExecuting}
            onClick={handleExecute}
            data-testid="persona-header-execute-btn"
            disabledReason={isThisPersonaExecuting ? 'Execution in progress' : undefined}
          >
            {isThisPersonaExecuting ? 'Running…' : 'Execute'}
          </Button>
          {/* Active toggle row */}
          <div className="flex items-center gap-2">
            <span className={`typo-heading transition-colors ${effective.enabled ? 'text-emerald-400' : 'text-muted-foreground/80'}`}>
              {effective.enabled ? 'Active' : 'Off'}
            </span>
            <AccessibleToggle
              checked={effective.enabled}
              onChange={handleHeaderToggle}
              label={`${effective.enabled ? 'Disable' : 'Enable'} ${effective.name}`}
              disabled={!effective.enabled && !readiness.canEnable}
              size="md"
              className={effective.enabled ? 'shadow-[0_0_12px_rgba(16,185,129,0.25)]' : ''}
            />
          </div>
          <AnimatePresence>
            {showReadinessPopover && readiness.reasons.length > 0 && (
              <motion.div
                ref={popoverRef}
                role="alert"
                aria-live="polite"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full right-0 mt-2 w-64 bg-background border border-amber-500/30 rounded-lg shadow-elevation-3 p-2.5 z-50"
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="typo-heading text-amber-400 mb-1.5 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> Cannot enable agent
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowReadinessPopover(false)}
                    aria-label="Dismiss"
                    className="w-6 h-6"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {readiness.reasons.map((r, i) => <p key={i} className="typo-body text-muted-foreground/80 pl-5">{r}</p>)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      }
    >
      {selectedPersona?.id && <QuickStatsBar personaId={selectedPersona.id} />}
    </ContentHeader>
  );
}
