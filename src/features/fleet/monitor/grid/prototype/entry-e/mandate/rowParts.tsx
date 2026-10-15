// The mandate drawer's row parts, cut from the Monitor's own: the bay's team
// colour edge (`Bay.tsx` nameplate), a steward's framed face (`PersonaLine`),
// a lamp with its state word, and spend as the Usage plate's thin bar
// (`PlanPlates`) beside its figure. Every register, act log, scopes and
// orphanage row is built from these, so a row in the drawer reads as a row on
// the board.

import type { ReactNode } from 'react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useSystemStore } from '@/stores/systemStore';
import { Lamp } from '../parts';
import { toneClass, type Lamp as LampModel } from '../tone';
import { statusLabel } from './mandateCopy';
import { stewardLamp } from './StewardRow';
import './mandateDrawer.css';

/** The team colour of a project's bay, or null when the project has no team. */
export function useProjectColor(projectId: string | null | undefined): string | null {
  const teamId = useSystemStore((s) => (projectId ? s.projects.find((p) => p.id === projectId)?.team_id ?? null : null));
  return usePipelineStore((s) => (teamId ? s.teams.find((t) => t.id === teamId)?.color ?? null : null));
}

/** The bay nameplate's edge light, inline before a name. No team: a quiet rule. */
export function ProjectEdge({ projectId, tall = false }: { projectId: string | null | undefined; tall?: boolean }) {
  const color = useProjectColor(projectId);
  return (
    <span
      aria-hidden
      className={`inline-block ${tall ? 'h-10' : 'h-5'} w-1 flex-shrink-0 rounded-full ${color ? '' : 'bg-foreground/15'}`}
      style={color ? { backgroundColor: colorWithAlpha(color, 0.85), boxShadow: `0 0 10px ${colorWithAlpha(color, 0.6)}` } : undefined}
    />
  );
}

/** A project name on its edge: the bay's nameplate, at row size. */
export function ProjectName({ projectId, children }: { projectId: string | null | undefined; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <ProjectEdge projectId={projectId} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** A steward's framed face and name; a persona the store does not hold shows its initials. */
export function StewardFace({ personaId, name, withName = true, large = false }: { personaId: string; name: string; withName?: boolean; large?: boolean }) {
  const persona = useAgentStore((s) => s.personas.find((p) => p.id === personaId) ?? null);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PersonaIcon icon={persona?.icon ?? null} color={persona?.color ?? null} name={name} display="framed" frameSize={large ? 'md' : 'sm'} frameClass="fb-face" />
      {withName && <span className="min-w-0 truncate typo-body text-foreground">{name}</span>}
    </span>
  );
}

/** A lamp and the word for what it shows. */
export function LampWord({ lamp, word, className = '' }: { lamp: LampModel; word: string; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      <Lamp lamp={lamp} />
      <span className={`truncate typo-caption ${lamp.lit ? 'text-foreground' : ''}`}>{word}</span>
    </span>
  );
}

/** A mandate's state as the Stewards plate lights it, with its word. */
export function MandateState({ mandate }: { mandate: MandateSummary }) {
  const { t } = useTranslation();
  return <LampWord lamp={stewardLamp(mandate)} word={statusLabel(t.monitor, mandate.status)} />;
}

/** Spend against the cap: the share used, toned as the Usage plate tones a window. */
export function spendShare(used: number | null, cap: number | null): number | null {
  return used !== null && cap !== null && cap > 0 ? Math.min(1, used / cap) : null;
}

export function spendTone(share: number) {
  return share >= 1 ? 'err' : share > 0.85 ? 'warn' : 'run';
}

/** The Usage plate's bar: its lit length is what is USED here (a cap fills up).
 *  No cap or no reading draws no bar: the figure's word says it. */
export function SpendBar({ used, cap }: { used: number | null; cap: number | null }) {
  const share = spendShare(used, cap);
  if (share === null) return null;
  return (
    <span className={`ae-bar block ${toneClass(spendTone(share))}`} aria-hidden>
      <i style={{ width: `${Math.max(share * 100, 2)}%` }} />
    </span>
  );
}

/** "$47.50 / $120" in figures, or the honest word when there is no cap or no reading. */
export function SpendFigure({ used, cap }: { used: number | null; cap: number | null }) {
  const { t } = useTranslation();
  const m = t.monitor;
  if (cap === null) return <span className="typo-caption">{m.ml_steward_no_cap}</span>;
  if (used === null) return <span className="typo-caption">{m.ml_steward_spend_unknown}</span>;
  return (
    <span className="typo-data tabular-nums text-foreground">
      <Numeric value={used} unit="usd" /><span className="typo-caption"> / <Numeric value={cap} unit="usd" /></span>
    </span>
  );
}

/** The register's spend cell: the bar over its figure's width, then the figure. */
export function SpendCell({ used, cap }: { used: number | null; cap: number | null }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="min-w-0 flex-1"><SpendBar used={used} cap={cap} /></span>
      <span className="flex-shrink-0"><SpendFigure used={used} cap={cap} /></span>
    </span>
  );
}

/** A count in figures, amber while it asks something of the operator. */
export function Figure({ n, warn = false, none }: { n: number | null; warn?: boolean; none: string }) {
  if (n === null) return <span className="typo-caption">{none}</span>;
  return <span className={`typo-data tabular-nums ${warn && n > 0 ? 'text-status-warning' : 'text-foreground'}`}><Numeric value={n} /></span>;
}
