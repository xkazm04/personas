/**
 * WP12 variants: the projects rail in the Stewards row grammar
 * (`entry-e/mandate/StewardRow.tsx`): ONE line per project, the bay's colour
 * edge, the members' presence as the bay header's share strip
 * (`Bay.tsx` `ae-share`), the unread and the asks as right-aligned tabular
 * figures under eyebrow column heads, and a lamp lit only while the project
 * holds something for the operator. Who is working, waiting or idle, and
 * whether a deliberation is live, is in the row's tooltip (the heartbeat dots
 * of today's row, said in words).
 */
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { Engraved, Lamp } from '@/features/fleet/monitor/grid/prototype/entry-e/parts';
import { PERSONA_THREADS, PROJECTS, COPY, type ProjectFixture } from './conversationVariantsData';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function Figure({ n, warn = false }: { n: number; warn?: boolean }) {
  return (
    <span className={`w-7 flex-shrink-0 text-right typo-data tabular-nums ${warn ? 'text-status-warning' : 'text-foreground'}`}>
      {n > 0 ? <Numeric value={n} /> : null}
    </span>
  );
}

function ProjectTip({ p }: { p: ProjectFixture }) {
  const { t, tx } = useTranslation();
  const [working, waiting, idle] = p.presence;
  return (
    <span className="flex flex-col gap-0.5 typo-caption">
      <span className="typo-heading text-foreground">{p.name}</span>
      <span>{tx(t.monitor.conv_working, { count: working })} · {waiting} {t.monitor.presence_waiting.toLowerCase()} · {idle} {t.monitor.presence_idle.toLowerCase()}</span>
      {p.live && <span>{t.monitor.conv_deliberation_active}</span>}
      <span><RelativeTime timestamp={minutesAgo(p.lastMin)} /></span>
    </span>
  );
}

function ProjectRow({ p, active, onSelect }: { p: ProjectFixture; active: boolean; onSelect: (id: string) => void }) {
  const [working, waiting, idle] = p.presence;
  return (
    <Tooltip placement="right" delay={400} content={<ProjectTip p={p} />}>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => onSelect(p.id)}
        aria-current={active}
        className={`ae-plan ae-focus relative pl-4! ${active ? 'is-open' : ''}`}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span aria-hidden className="absolute inset-y-1.5 left-1 w-1 rounded-full" style={{ backgroundColor: colorWithAlpha(p.color, 0.85) }} />
          <span className={`min-w-0 flex-1 truncate typo-body ${active ? 'text-primary' : 'text-foreground'}`}>{p.name}</span>
          <span className="ae-share w-6 flex-shrink-0" aria-hidden>
            <span className="ae-t-run" style={{ flexGrow: working }} />
            <span className="ae-t-warn" style={{ flexGrow: waiting }} />
            <span className="ae-t-off" style={{ flexGrow: idle, opacity: 0.35 }} />
          </span>
          <Figure n={p.unread} />
          <Figure n={p.asks} warn />
          <Lamp lamp={{ tone: 'warn', lit: p.asks > 0 }} />
        </span>
      </Button>
    </Tooltip>
  );
}

function PersonaRow({ personaId, unread }: { personaId: string; unread: number }) {
  const persona = usePersonaIndex().get(personaId);
  if (!persona) return null;
  return (
    <Button variant="ghost" size="xs" className="ae-plan ae-focus">
      <span className="flex w-full min-w-0 items-center gap-2">
        <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="sm" />
        <span className="min-w-0 flex-1 truncate typo-body text-foreground">{persona.name}</span>
        <Figure n={unread} />
        <Lamp lamp={{ tone: 'warn', lit: false }} />
      </span>
    </Button>
  );
}

/** The rail plate: engraved head with the two column heads, the projects, then the persona threads. */
export function ProjectsPlate({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <section className="ae-plate flex h-full min-h-0 flex-col overflow-hidden rounded-card" data-testid="cv-projects">
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-border pl-3.5 pr-2">
        <Engraved className="min-w-0 flex-1 truncate">{t.monitor.conv_projects}</Engraved>
        <span className="w-6 flex-shrink-0" />
        <Engraved className="w-7 flex-shrink-0 text-right">{COPY.colNew}</Engraved>
        <Engraved className="w-7 flex-shrink-0 text-right">{COPY.colYou}</Engraved>
        <span className="w-2 flex-shrink-0" />
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {PROJECTS.map((p) => <ProjectRow key={p.id} p={p} active={p.id === active} onSelect={onSelect} />)}
        <div className="px-2 pb-1 pt-3"><Engraved>{t.monitor.conv_persona_group}</Engraved></div>
        {PERSONA_THREADS.map((r) => <PersonaRow key={r.personaId} personaId={r.personaId} unread={r.unread} />)}
      </div>
    </section>
  );
}
