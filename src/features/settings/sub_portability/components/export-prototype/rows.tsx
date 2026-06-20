import { Cpu, ShieldCheck, KeyRound, Users, Target, AlertTriangle, Power } from 'lucide-react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { SelectBox, StatChip } from './atoms';

const ROW_BASE =
  'group flex items-center gap-3 px-3 py-2.5 rounded-card cursor-pointer transition-colors border';
const rowTone = (selected: boolean) =>
  selected
    ? 'border-emerald-500/40'
    : 'border-transparent hover:bg-secondary/20';

// ---------------------------------------------------------------------------
// Persona pick row
// ---------------------------------------------------------------------------

export function PersonaPickRow({
  persona,
  teams,
  selected,
  onToggle,
}: {
  persona: Persona;
  teams: PersonaTeam[];
  selected: boolean;
  onToggle: () => void;
}) {
  const { t, tx } = useTranslation();
  const p = t.settings.portability.proto;
  const teamLabel =
    teams.length === 0
      ? p.no_team
      : teams.length === 1
        ? tx(p.in_team, { team: teams[0]!.name })
        : tx(p.multi_team, { count: teams.length });
  return (
    <label className={`${ROW_BASE} ${rowTone(selected)}`}>
      <SelectBox state={selected} onChange={onToggle} ariaLabel={persona.name} />
      <PersonaIcon
        icon={persona.icon}
        color={persona.color}
        display="pop"
        frameSize="sm"
        frameClass="border border-primary/15"
        frameStyle={{ backgroundColor: `${persona.color ?? 'var(--primary)'}15` }}
      />
      <div className="min-w-0 flex-1">
        <span className="typo-body font-medium text-foreground truncate">{persona.name}</span>
      </div>
      <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
        {!persona.enabled && (
          <StatChip icon={<Power className="w-3 h-3" />} title={p.disabled}>
            {p.disabled}
          </StatChip>
        )}
        {persona.model_profile && (
          <StatChip icon={<Cpu className="w-3 h-3" />} tone="violet" title={p.model_label}>
            <span className="max-w-[8rem] truncate">{persona.model_profile}</span>
          </StatChip>
        )}
        <StatChip icon={<ShieldCheck className="w-3 h-3" />} tone="emerald" title={p.trust_label_full}>
          {persona.trust_score}
        </StatChip>
        <StatChip icon={<Users className="w-3 h-3" />} title={p.team_label}>
          {teamLabel}
        </StatChip>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Team pick row — member count + KPI setup badges
// ---------------------------------------------------------------------------

export function TeamPickRow({
  team,
  memberCount,
  kpiCount,
  offTrackCount,
  selected,
  onToggle,
}: {
  team: PersonaTeam;
  memberCount: number;
  kpiCount: number;
  offTrackCount: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t, tx } = useTranslation();
  const p = t.settings.portability.proto;
  return (
    <label className={`${ROW_BASE} ${rowTone(selected)}`}>
      <SelectBox state={selected} onChange={onToggle} ariaLabel={team.name} />
      <span
        className="w-8 h-8 rounded-card flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${team.color}24`, color: team.color }}
      >
        <Users className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="typo-body font-medium text-foreground truncate">{team.name}</div>
        {team.description && (
          <p className="typo-caption text-foreground truncate">{team.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <StatChip icon={<Users className="w-3 h-3" />} title={p.members_label}>
          {memberCount}
        </StatChip>
        {kpiCount > 0 && (
          <StatChip icon={<Target className="w-3 h-3" />} tone="rose" title={p.kpi_setup_title}>
            {tx(p.kpi_count_label, { count: kpiCount })}
          </StatChip>
        )}
        {offTrackCount > 0 && (
          <StatChip icon={<AlertTriangle className="w-3 h-3" />} tone="amber" title={p.kpi_off_track}>
            {offTrackCount}
          </StatChip>
        )}
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Credential row
// ---------------------------------------------------------------------------

export function CredentialRow({
  credential,
  selected,
  onToggle,
}: {
  credential: PersonaCredential;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`${ROW_BASE} ${rowTone(selected)}`}>
      <SelectBox state={selected} onChange={onToggle} ariaLabel={credential.name} />
      <span className="w-8 h-8 rounded-card flex items-center justify-center bg-amber-500/10 text-amber-300 flex-shrink-0">
        <KeyRound className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="typo-body font-medium text-foreground truncate">{credential.name}</div>
        <div className="typo-caption text-foreground truncate">{credential.serviceType}</div>
      </div>
      {credential.lastUsedAt && (
        <span className="typo-caption text-foreground flex-shrink-0">
          <RelativeTime timestamp={credential.lastUsedAt} />
        </span>
      )}
    </label>
  );
}
