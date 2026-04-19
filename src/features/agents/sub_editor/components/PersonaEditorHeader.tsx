import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
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
import type { PersonaDraft } from '../libs/PersonaDraft';
import { useEffectivePersona } from '../libs/useEffectivePersona';
import { QuickStatsBar } from './QuickStatsBar';
import { useTranslation } from '@/i18n/useTranslation';

interface PersonaEditorHeaderProps {
  draft: PersonaDraft;
  baseline: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  setBaseline: React.Dispatch<React.SetStateAction<PersonaDraft>>;
}

/**
 * Persona editor header — persona identity + governance controls.
 *
 * Phase C3 — the persona-wide **Execute** button has been removed; running
 * is now a per-capability action surfaced inside the Use Case tab. Only
 * governance remains here: the Active toggle (which flips persona-level
 * runnability) and the readiness popover that explains why a persona can't
 * be enabled.
 *
 * See `docs/concepts/persona-capabilities/08-frontend-impact.md`.
 */
export function PersonaEditorHeader({ draft, baseline, patch, setBaseline }: PersonaEditorHeaderProps) {
  const { t, tx } = useTranslation();
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

  const triggers = selectedPersona?.triggers;
  const subscriptions = selectedPersona?.subscriptions;
  const tools = selectedPersona?.tools;

  const readiness = useMemo(() => {
    if (!selectedPersona) return { canEnable: false, reasons: [] as string[] };
    const reasons: string[] = [];
    if (!(triggers || []).length && !(subscriptions || []).length) {
      reasons.push(t.agents.editor_ui.no_triggers_or_subs);
    }
    const credTypes = new Set(credentials.map((c) => c.service_type));
    const missingCreds = (tools || [])
      .filter((tl) => tl.requires_credential_type && !credTypes.has(tl.requires_credential_type))
      .map((tl) => tl.requires_credential_type!);
    const unique = [...new Set(missingCreds)];
    if (unique.length > 0) reasons.push(tx(t.agents.editor_ui.missing_credentials, { credentials: unique.join(', ') }));
    return { canEnable: reasons.length === 0, reasons };
  }, [selectedPersona, triggers, subscriptions, tools, credentials, t, tx]);

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
    } catch { useToastStore.getState().addToast(t.agents.header.toggle_failed, 'error'); }
  }, [selectedPersona, readiness, applyPersonaOp, patch, setBaseline, t]);

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
          {/* Active toggle — governance only. Per-capability Run/Simulate lives in the Use Case tab. */}
          <div className="flex items-center gap-2">
            <span className={`typo-heading transition-colors ${effective.enabled ? 'text-emerald-400' : 'text-foreground'}`}>
              {effective.enabled ? t.common.active : t.common.off}
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
                className="absolute top-full right-0 mt-2 w-64 bg-background border border-amber-500/30 rounded-card shadow-elevation-3 p-2.5 z-50"
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="typo-heading text-amber-400 mb-1.5 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {t.agents.editor_ui.cannot_enable}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowReadinessPopover(false)}
                    aria-label={t.common.dismiss}
                    className="w-6 h-6"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {readiness.reasons.map((r, i) => <p key={i} className="typo-body text-foreground pl-5">{r}</p>)}
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
