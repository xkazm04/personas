import { useEffect, useMemo, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CollabLiveCorrespondence } from '@/features/teams/sub_collab/CollabLiveCorrespondence';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import { ChannelTimelineWorkspace, type WorkspaceTeam } from './ChannelTimelineWorkspace';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';

type ChannelLayout = 'grid' | 'timeline';

/**
 * Channel mode — watch multiple team channels at once. A thin compact topbar
 * selects/deselects teams + a layout switcher: GRID (separate channels, full
 * per-team interaction) or the combined TIMELINE (all teams merged into one
 * virtualized chronological stream). Members are derived from personas by
 * `home_team_id`, so no extra fetch is needed.
 */
export function MonitorChannelGrid({ teams, personas }: { teams: PersonaTeam[]; personas: Persona[] }) {
  const { t } = useTranslation();

  // Members per team (lightweight ChannelMember rows from the persona roster).
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

  // Teams that actually have a roster (a channel to show).
  const channelTeams = useMemo(
    () => teams.filter((tm) => (membersByTeam.get(tm.id)?.length ?? 0) > 0),
    [teams, membersByTeam],
  );

  // Selection — defaults to all teams once they load; never auto-clears the
  // user's pick on re-render.
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

  const shown = channelTeams.filter((tm) => selected.has(tm.id));

  // Layout: the combined TIMELINE is the default (compact, scales to hundreds
  // of rows); GRID (separate channels) is one click away for per-team action.
  const [layout, setLayout] = useState<ChannelLayout>('timeline');
  const LAYOUTS: Array<{ id: ChannelLayout; label: string; hint: string }> = [
    { id: 'timeline', label: t.monitor.channels_layout_timeline, hint: t.monitor.channels_layout_timeline_hint },
    { id: 'grid', label: t.monitor.channels_layout_grid, hint: t.monitor.channels_layout_grid_hint },
  ];
  // All channel teams + their selected flag + roster — the workspace owns the
  // team filter (left sidebar), so the topbar chips are grid-mode only.
  const workspaceTeams: WorkspaceTeam[] = useMemo(
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
            layout === l.id ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground/50 hover:text-foreground/80'
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

  // TIMELINE — the flagship workspace (own team sidebar + Quick Answer + composer).
  if (layout === 'timeline') {
    return (
      <div className="h-full p-2">
        <ChannelTimelineWorkspace
          teams={workspaceTeams}
          onToggle={toggle}
          allOn={allOn}
          onSetAll={setAll}
          layoutControl={layoutSwitcher}
        />
      </div>
    );
  }

  // GRID — separate channels with the topbar team chips.
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-primary/10 bg-secondary/10 overflow-x-auto">
        <span className="typo-label uppercase tracking-wider text-foreground flex-shrink-0">{t.monitor.channels_teams_label}</span>
        {channelTeams.map((tm) => {
          const on = selected.has(tm.id);
          return (
            <button
              key={tm.id}
              type="button"
              onClick={() => toggle(tm.id)}
              aria-pressed={on}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption transition-colors ${
                on ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-primary/10 bg-secondary/20 text-foreground/50 hover:text-foreground/80'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: tm.color, opacity: on ? 1 : 0.4 }} />
              <span className="truncate max-w-[140px]">{tm.name}</span>
            </button>
          );
        })}
        {channelTeams.length > 1 && (
          <button
            type="button"
            onClick={() => setAll(!allOn)}
            className="flex-shrink-0 ml-1 px-2 py-1 rounded-full border border-primary/10 typo-caption text-foreground hover:text-foreground/85 hover:bg-secondary/30 transition-colors"
          >
            {allOn ? t.monitor.channels_none : t.monitor.channels_all}
          </button>
        )}
        <div className="ml-auto">{layoutSwitcher}</div>
      </div>

      <div className="flex-1 min-h-0">
        {shown.length === 0 ? (
          <div className="h-full flex items-center justify-center typo-body text-foreground">{t.monitor.channels_select_prompt}</div>
        ) : (
          <div className="h-full overflow-y-auto p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-3">
              {shown.map((tm) => (
                <div key={tm.id} className="h-[460px] min-h-0">
                  <CollabLiveCorrespondence teamId={tm.id} members={membersByTeam.get(tm.id) ?? []} teamName={tm.name} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MonitorChannelGrid;
