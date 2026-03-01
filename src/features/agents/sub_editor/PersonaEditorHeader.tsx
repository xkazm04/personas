import { useState, useMemo, useCallback } from 'react';
import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizeUrl';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentHeader } from '@/features/shared/components/ContentLayout';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import type { PersonaDraft } from './PersonaDraft';

interface PersonaEditorHeaderProps {
  patch: (updates: Partial<PersonaDraft>) => void;
  setBaseline: React.Dispatch<React.SetStateAction<PersonaDraft>>;
}

export function PersonaEditorHeader({ patch, setBaseline }: PersonaEditorHeaderProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const applyPersonaOp = usePersonaStore((s) => s.applyPersonaOp);
  const credentials = usePersonaStore((s) => s.credentials);
  const [showReadinessTooltip, setShowReadinessTooltip] = useState(false);

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
      setShowReadinessTooltip(true);
      setTimeout(() => setShowReadinessTooltip(false), 3000);
      return;
    }
    try {
      await applyPersonaOp(selectedPersona.id, { kind: 'ToggleEnabled', enabled: nextEnabled });
      patch({ enabled: nextEnabled });
      setBaseline((prev) => ({ ...prev, enabled: nextEnabled }));
    } catch { /* store.error already set */ }
  }, [selectedPersona, readiness, applyPersonaOp, patch, setBaseline]);

  if (!selectedPersona) return null;

  const safeIconUrl = sanitizeIconUrl(selectedPersona.icon);
  const personaIcon = selectedPersona.icon ? (
    safeIconUrl ? (
      <img src={safeIconUrl} alt="" className="w-6 h-6 rounded" referrerPolicy="no-referrer" crossOrigin="anonymous" />
    ) : isIconUrl(selectedPersona.icon) ? null : (
      <span className="text-2xl leading-none">{selectedPersona.icon}</span>
    )
  ) : (
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
      style={{ backgroundColor: `${selectedPersona.color || '#6B7280'}20`, border: `1px solid ${selectedPersona.color || '#6B7280'}40`, color: selectedPersona.color || '#6B7280' }}
    >
      {selectedPersona.name.charAt(0).toUpperCase()}
    </div>
  );

  return (
    <ContentHeader
      icon={personaIcon}
      title={selectedPersona.name}
      subtitle={selectedPersona.description || undefined}
      actions={
        <div className="relative flex items-center gap-2 flex-shrink-0">
          <span className={`text-sm font-medium transition-colors ${selectedPersona.enabled ? 'text-emerald-400' : 'text-muted-foreground/80'}`}>
            {selectedPersona.enabled ? 'Active' : 'Off'}
          </span>
          <AccessibleToggle
            checked={selectedPersona.enabled}
            onChange={handleHeaderToggle}
            label={`${selectedPersona.enabled ? 'Disable' : 'Enable'} ${selectedPersona.name}`}
            disabled={!selectedPersona.enabled && !readiness.canEnable}
            size="lg"
            className={selectedPersona.enabled ? 'shadow-[0_0_12px_rgba(16,185,129,0.25)]' : ''}
          />
          <AnimatePresence>
            {showReadinessTooltip && readiness.reasons.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 4, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.95 }} className="absolute top-full right-0 mt-2 w-64 bg-background border border-amber-500/30 rounded-lg shadow-xl p-2.5 z-50">
                <p className="text-sm font-medium text-amber-400 mb-1.5 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> Cannot enable persona
                </p>
                {readiness.reasons.map((r, i) => <p key={i} className="text-sm text-muted-foreground/80 pl-5">{r}</p>)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      }
    />
  );
}
