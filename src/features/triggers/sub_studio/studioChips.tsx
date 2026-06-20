/**
 * studioChips — small presentational chips shared by the Chain Studio surface
 * and its deep-merge ledger variants. A source/target chip renders a trigger
 * template or a persona; PatchEndChip renders one end of the pending-patch
 * strip (source, persona target, or system-op target).
 */
import { Zap, Cog } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Persona } from '@/lib/bindings/Persona';
import type { SystemOpKindMeta } from '@/api/systemOps';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { findTrigger, personaName, type DraftSource } from './libs/studioDraftModel';

export function SourceChip({ source, personas, completesLabel }: {
  source: DraftSource; personas: Persona[]; completesLabel: string;
}) {
  if (source.kind === 'trigger') {
    const tpl = findTrigger(source.triggerType);
    const Icon = tpl?.icon ?? Zap;
    return (
      <span className="flex items-center gap-2 min-w-0 shrink">
        <span className={`w-7 h-7 rounded-input flex items-center justify-center bg-secondary/60 shrink-0 ${tpl?.color ?? 'text-amber-400'}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="typo-body font-medium text-foreground truncate">{tpl?.label ?? source.triggerType}</span>
      </span>
    );
  }
  const p = personas.find((x) => x.id === source.personaId);
  return (
    <span className="flex items-center gap-2 min-w-0 shrink">
      <PersonaIcon icon={p?.icon} color={p?.color} display="framed" frameSize="sm" />
      <span className="typo-body font-medium text-foreground truncate">{p?.name ?? personaName(source.personaId, personas)}</span>
      <span className="typo-body opacity-80 text-foreground shrink-0">{completesLabel}</span>
    </span>
  );
}

export function TargetChip({ targetId, personas }: { targetId: string; personas: Persona[] }) {
  const p = personas.find((x) => x.id === targetId);
  return (
    <span className="flex items-center gap-2 min-w-0 shrink">
      <PersonaIcon icon={p?.icon} color={p?.color} display="framed" frameSize="sm" />
      <span className="typo-body font-medium text-foreground truncate">{p?.name ?? personaName(targetId, personas)}</span>
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
        <span className="w-7 h-7 rounded-input flex items-center justify-center bg-secondary/60 shrink-0 text-violet-400">
          <Cog className="w-3.5 h-3.5" />
        </span>
        <span className="typo-body font-medium text-foreground truncate">{k?.label ?? systemOpKind}</span>
      </span>
    );
  }
  return <span className="typo-body text-foreground italic">{placeholder}</span>;
}
