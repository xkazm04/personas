/**
 * studioChips — small presentational chips for the Chain Studio unified
 * ledger (`StudioPatchbay`). A source/target chip renders a trigger
 * template or a persona; PatchEndChip renders one end of the pending-patch
 * strip (source, persona target, or system-op target).
 */
import { Zap, Cog, Store } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Persona } from '@/lib/bindings/Persona';
import type { SystemOpKindMeta } from '@/api/systemOps';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { findTrigger, personaName, type DraftSource } from './libs/studioDraftModel';
import { templateCopy } from './libs/triggerStudioConstants';

export function SourceChip({ source, personas, completesLabel }: {
  source: DraftSource; personas: Persona[]; completesLabel: string;
}) {
  const { t } = useTranslation();
  if (source.kind === 'trigger') {
    const tpl = findTrigger(source.triggerType);
    const Icon = tpl?.icon ?? Zap;
    return (
      <span className="flex items-center gap-2 min-w-0 shrink">
        <span className={`w-7 h-7 rounded-input flex items-center justify-center bg-surface-2 shrink-0 ${tpl?.color ?? 'text-status-warning'}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="typo-body text-ink-1 truncate">{tpl ? templateCopy(t, tpl).label : source.triggerType}</span>
      </span>
    );
  }
  if (source.kind === 'marketplace') {
    return (
      <span className="flex items-center gap-2 min-w-0 shrink">
        <span className="w-7 h-7 rounded-input flex items-center justify-center bg-surface-2 shrink-0 text-status-info">
          <Store className="w-3.5 h-3.5" />
        </span>
        <span className="typo-body text-ink-1 truncate">{source.label}</span>
      </span>
    );
  }
  const p = personas.find((x) => x.id === source.personaId);
  return (
    <span className="flex items-center gap-2 min-w-0 shrink">
      <PersonaIcon icon={p?.icon} color={p?.color} display="framed" frameSize="sm" />
      <span className="typo-body text-ink-1 truncate">{p?.name ?? personaName(source.personaId, personas, t.triggers.studio.unknown_persona)}</span>
      <span className="typo-body opacity-80 text-ink-1 shrink-0">{completesLabel}</span>
    </span>
  );
}

export function TargetChip({ targetId, personas }: { targetId: string; personas: Persona[] }) {
  const { t } = useTranslation();
  const p = personas.find((x) => x.id === targetId);
  return (
    <span className="flex items-center gap-2 min-w-0 shrink">
      <PersonaIcon icon={p?.icon} color={p?.color} display="framed" frameSize="sm" />
      <span className="typo-body text-ink-1 truncate">{p?.name ?? personaName(targetId, personas, t.triggers.studio.unknown_persona)}</span>
    </span>
  );
}

export function PatchEndChip({ source, targetId, systemOpKind, personas, kinds, placeholder }: {
  source?: DraftSource | null; targetId?: string | null; systemOpKind?: string | null;
  personas: Persona[];
  kinds?: SystemOpKindMeta[];
  placeholder: string;
}) {
  const { t } = useTranslation();
  if (source) return <SourceChip source={source} personas={personas} completesLabel={t.triggers.studio.persona_completes} />;
  if (targetId) return <TargetChip targetId={targetId} personas={personas} />;
  if (systemOpKind) {
    const k = kinds?.find((x) => x.kind === systemOpKind);
    return (
      <span className="flex items-center gap-2 min-w-0 shrink">
        <span className="w-7 h-7 rounded-input flex items-center justify-center bg-surface-2 shrink-0 text-role-agent">
          <Cog className="w-3.5 h-3.5" />
        </span>
        <span className="typo-body text-ink-1 truncate">{k?.label ?? systemOpKind}</span>
      </span>
    );
  }
  return <span className="typo-body text-ink-1 italic">{placeholder}</span>;
}
