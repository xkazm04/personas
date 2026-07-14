import { memo, useEffect, useMemo, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import { Stream } from './Stream';
import { ConversationBriefing } from './ConversationBriefing';
import type { StreamTeam } from './types';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';

/** The two Channel surfaces. Stream = the read-only log (many teams, one flat
 *  feed). Conversations = the messenger (one project, and the only place you
 *  write) — plan D5. The old GRID of cramped per-team channel cards is retired:
 *  it was a worse messenger with none of the affordances. */
type ChannelLayout = 'stream' | 'conversations';

/**
 * Channel mode. Members are derived from personas by `home_team_id`, so no
 * extra fetch is needed.
 */
function MonitorChannelGridImpl({ teams, personas }: { teams: PersonaTeam[]; personas: Persona[] }) {
  const { t } = useTranslation();

  const membersByTeam = useMemo(() => {
    const map = new Map<string, ChannelMember[]>();
    for (const p of personas) {
      if (!p.home_team_id) continue;
      const arr = map.get(p.home_team_id) ?? [];
      arr.push({ memberId: p.id, personaId: p.id, name: p.name, icon: p.icon, color: p.color });
      map.set(p.home_team_id, arr);
    }
    return map;
  }, [personas]);

  const channelTeams = useMemo(
    () => teams.filter((tm) => (membersByTeam.get(tm.id)?.length ?? 0) > 0),
    [teams, membersByTeam],
  );

  // Stream's team filter. Conversations picks ONE project from its sidebar, so
  // it ignores this — but the selection persists across a layout switch.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && channelTeams.length > 0) {
      setSelected(new Set(channelTeams.map((tm) => tm.id)));
    }
  }, [channelTeams, touched]);

  const toggle = (id: string) => {
    setTouched(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allOn = channelTeams.length > 0 && channelTeams.every((tm) => selected.has(tm.id));
  const setAll = (on: boolean) => {
    setTouched(true);
    setSelected(on ? new Set(channelTeams.map((tm) => tm.id)) : new Set());
  };

  const [layout, setLayout] = useState<ChannelLayout>('stream');
  const LAYOUTS: Array<{ id: ChannelLayout; label: string; hint: string }> = [
    { id: 'stream', label: t.monitor.channels_layout_timeline, hint: t.monitor.channels_layout_timeline_hint },
    { id: 'conversations', label: t.monitor.channels_layout_grid, hint: t.monitor.channels_layout_grid_hint },
  ];

  const workspaceTeams: StreamTeam[] = useMemo(
    () =>
      channelTeams.map((tm) => ({
        teamId: tm.id,
        teamName: tm.name,
        teamColor: tm.color,
        members: membersByTeam.get(tm.id) ?? [],
        selected: selected.has(tm.id),
      })),
    [channelTeams, selected, membersByTeam],
  );

  const layoutSwitcher = (
    <div className="flex-shrink-0 flex items-center gap-0.5 rounded-full bg-secondary/20 p-0.5">
      {LAYOUTS.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => setLayout(l.id)}
          title={l.hint}
          aria-pressed={layout === l.id}
          className={`px-2.5 py-0.5 rounded-full typo-caption transition-colors ${
            layout === l.id ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground opacity-50 hover:opacity-80'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );

  if (channelTeams.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-foreground">
        <MessagesSquare className="w-8 h-8 text-foreground" />
        <span className="typo-body">{t.monitor.channels_no_teams}</span>
      </div>
    );
  }

  return (
    <div className="h-full p-2">
      {layout === 'stream' ? (
        <Stream
          teams={workspaceTeams}
          onToggle={toggle}
          allOn={allOn}
          onSetAll={setAll}
          layoutControl={layoutSwitcher}
        />
      ) : (
        <ConversationBriefing teams={workspaceTeams} layoutControl={layoutSwitcher} />
      )}
    </div>
  );
}

/**
 * Memoized: `teams`/`personas` are stable store selectors, so PersonaMonitor's
 * frequent re-renders (e.g. the fleet 1s elapsed-time tick) bail out here
 * instead of cascading into the whole channel workspace.
 */
export const MonitorChannelGrid = memo(MonitorChannelGridImpl);

export default MonitorChannelGrid;
