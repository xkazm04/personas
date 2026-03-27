import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
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
import type { PersonaDraft } from '../libs/PersonaDraft';
import { useEffectivePersona } from '../libs/useEffectivePersona';

interface PersonaEditorHeaderProps {
  draft: PersonaDraft;
  baseline: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  setBaseline: React.Dispatch<React.SetStateAction<PersonaDraft>>;
}

export function PersonaEditorHeader({ draft, baseline, patch, setBaseline }: PersonaEditorHeaderProps) {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const credentials = useVaultStore((s) => s.credentials);
  const effective = useEffectivePersona(draft, baseline);
  const designContext = useParsedDesignContext();
  const [showReadinessPopover, setShowReadinessPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useClickOutside(popoverRef, showReadinessPopover, () => setShowReadinessPopover(false));

  useEffect(() => {
    if (!showReadinessPopover) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowReadinessPopover(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showReadinessPopover]);

  const readiness = useMemo(() => {
    if (!selectedPersona) return { canEnable: false, reasons: [] as string[] };
    const reasons: string[] = [];
    if (!(selectedPersona.triggers || []).length && !(selectedPersona.subscriptions || []).length) {
      reasons.push('No triggers or event subscriptions configured');
    }
    const credTypes = new Set(credentials.map((c) => c.service_type));
    const missingCreds = (selectedPersona.tools || [])
      .filter((t) => t.requires_credential_type && !credTypes.has(t.requires_credential_type))
      .map((t) => t.requires_credential_type!);
    const unique = [...new Set(missingCreds)];
    if (unique.length > 0) reasons.push(`Missing credentials: ${unique.join(', ')}`);
    return { canEnable: reasons.length === 0, reasons };
  }, [selectedPersona, credentials]);

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
        <div className="relative flex items-center gap-2 flex-shrink-0">
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
                  <button
                    type="button"
                    onClick={() => setShowReadinessPopover(false)}
                    className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    aria-label="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {readiness.reasons.map((r, i) => <p key={i} className="typo-body text-muted-foreground/80 pl-5">{r}</p>)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      }
    />
  );
}
