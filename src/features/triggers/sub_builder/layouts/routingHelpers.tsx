import { Zap, X, GitBranch, type LucideIcon, Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow, Layers, FileEdit, CheckCircle2, XCircle, Store } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { EventSourceTemplate } from '../libs/eventCanvasConstants';

// ---------------------------------------------------------------------------
// Icon resolution
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow,
  Layers, Zap, FileEdit, CheckCircle2, XCircle, Store,
};

export function resolveIcon(tmpl: EventSourceTemplate | undefined): LucideIcon {
  if (!tmpl) return Zap;
  const name = tmpl.icon?.displayName;
  return name ? (ICON_MAP[name] ?? Zap) : Zap;
}

// ---------------------------------------------------------------------------
// PersonaChip
// ---------------------------------------------------------------------------

interface PersonaChipProps {
  persona: Persona | undefined;
  personaIdFallback: string;
  badge?: { text: string; title?: string };
  onRemove?: () => void;
}

export function PersonaChip({ persona, personaIdFallback, badge, onRemove }: PersonaChipProps) {
  return (
    <div className="flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-lg bg-card border border-emerald-400/20 hover:border-emerald-400/40 group/chip transition-colors">
      <PersonaIcon
        icon={persona?.icon ?? null}
        color={persona?.color ?? null}
        display="framed"
        frameSize="md"
      />
      <span className="text-sm text-foreground/80">
        {persona?.name ?? personaIdFallback.slice(0, 8)}
      </span>
      {badge && (
        <span
          title={badge.title}
          className="ml-0.5 inline-flex items-center gap-0.5 px-1 py-[1px] rounded text-[9px] font-semibold uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-400/20"
        >
          <GitBranch className="w-2.5 h-2.5" />
          {badge.text}
        </span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="p-0.5 rounded opacity-0 group-hover/chip:opacity-100 hover:bg-red-500/15 text-red-400/50 hover:text-red-400 transition-all"
          title="Disconnect"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chain trigger parsing
// ---------------------------------------------------------------------------

export interface ChainTriggerView {
  trigger: PersonaTrigger;
  sourcePersonaId: string;
  eventType: string;
  conditionType: string;
}

export function parseChainTrigger(t: PersonaTrigger): ChainTriggerView | null {
  if (t.trigger_type !== 'chain' || !t.config) return null;
  try {
    const cfg = JSON.parse(t.config) as {
      source_persona_id?: string;
      event_type?: string;
      condition?: { type?: string };
    };
    if (!cfg.source_persona_id) return null;
    return {
      trigger: t,
      sourcePersonaId: cfg.source_persona_id,
      eventType: cfg.event_type || 'chain_triggered',
      conditionType: cfg.condition?.type || 'any',
    };
  } catch {
    return null;
  }
}
