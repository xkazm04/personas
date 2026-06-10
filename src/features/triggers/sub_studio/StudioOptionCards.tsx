/**
 * StudioOptionCards — shared palette option cards for the canvas-less
 * Chain Studio variants. Cards answer "what am I working with?": trigger
 * cards carry the type description; persona cards carry model tier, trust,
 * readiness, and recency pulled from the live Persona binding.
 *
 * Prototype-phase file shared by StudioSwitchboard + StudioComposer.
 */
import { ShieldCheck, ShieldAlert, EyeOff } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import {
  modelTierLabel, modelTierAccent, attentionFor, relativeUpdated,
} from '@/features/home/sub_cockpit/widgets/personaStats';
import type { TriggerBlockTemplate } from './libs/triggerStudioConstants';

export function TriggerOptionCard({
  template, active, dense, onPick,
}: {
  template: TriggerBlockTemplate;
  active?: boolean;
  /** dense = rail row (Switchboard); false = hero card (Composer). */
  dense?: boolean;
  onPick: () => void;
}) {
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full text-left rounded-card border transition-all flex items-center gap-3 ${
        dense ? 'px-2.5 py-2' : 'px-4 py-3'
      } ${
        active
          ? 'bg-primary/10 border-primary/40 shadow-elevation-1'
          : 'bg-background/80 border-border hover:bg-foreground/[0.04] hover:border-foreground/20'
      }`}
    >
      <div className={`rounded-input flex items-center justify-center shrink-0 bg-secondary/60 ${dense ? 'w-8 h-8' : 'w-10 h-10'} ${template.color}`}>
        <Icon className={dense ? 'w-4 h-4' : 'w-5 h-5'} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`${dense ? 'typo-body' : 'typo-body-lg'} font-medium text-foreground truncate`}>{template.label}</div>
        <div className="typo-caption text-foreground truncate">{template.description}</div>
      </div>
    </button>
  );
}

export function PersonaOptionCard({
  persona, active, dense, hint, onPick,
}: {
  persona: Persona;
  active?: boolean;
  dense?: boolean;
  /** Optional context line overriding the description (e.g. "after this persona completes"). */
  hint?: string;
  onPick: () => void;
}) {
  const tier = modelTierAccent(persona.model_profile);
  const tierLabel = modelTierLabel(persona.model_profile);
  const attention = attentionFor(persona);
  const trusted = persona.trust_score >= 0.75;

  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full text-left rounded-card border transition-all flex items-center gap-3 ${
        dense ? 'px-2.5 py-2' : 'px-4 py-3'
      } ${
        active
          ? 'bg-primary/10 border-primary/40 shadow-elevation-1'
          : 'bg-background/80 border-border hover:bg-foreground/[0.04] hover:border-foreground/20'
      }`}
    >
      <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize={dense ? 'md' : 'lg'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`${dense ? 'typo-body' : 'typo-body-lg'} font-medium text-foreground truncate`}>{persona.name}</span>
          {persona.headless && <EyeOff className="w-3 h-3 text-foreground shrink-0" />}
        </div>
        <div className="typo-caption text-foreground truncate">
          {hint ?? persona.description ?? 'Agent'}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`typo-label px-1.5 py-0.5 rounded-input ${tier.bgSoftClass} ${tier.textClass}`}>{tierLabel}</span>
          {trusted
            ? <span className="flex items-center gap-1 typo-caption text-status-success"><ShieldCheck className="w-3 h-3" />{Math.round(persona.trust_score * 100)}</span>
            : <span className="flex items-center gap-1 typo-caption text-foreground"><ShieldAlert className="w-3 h-3" />{Math.round(persona.trust_score * 100)}</span>}
          {attention && (
            <span className={`typo-caption ${attention.tone === 'bad' ? 'text-status-error' : 'text-status-warning'}`}>{attention.label}</span>
          )}
          {!dense && <span className="typo-caption text-foreground ml-auto">{relativeUpdated(persona.updated_at)}</span>}
        </div>
      </div>
    </button>
  );
}
