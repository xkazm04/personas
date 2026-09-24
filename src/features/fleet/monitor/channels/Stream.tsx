import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Radio, Search, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import { memberColor, type EventFamily } from '@/lib/channel/eventModel';
import type { ChannelKind } from '@/api/pipeline/teamChannel';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { DevProject } from '@/lib/bindings/DevProject';
import { useSystemStore } from '@/stores/systemStore';
import { WorkspaceProjectSelector } from '@/features/plugins/dev-tools/sub_workspaces/WorkspaceProjectSelector';
import { LensStream } from './LensStream';
import { useLensFeed } from './useLensFeed';
import { StreamMemoryViews } from './StreamMemoryViews';
import { KIND_META } from './streamKinds';
import {
  ALL_FAMILIES, STREAM_KINDS, EMPTY_LENS, activeLensCount, callsign, facetCounts, fetchKinds,
  matchesLens, memoryModesAvailable, SPEAKER_REMOVED, SPEAKER_SYSTEM, type LensState, type MemoryMode,
} from './lensModel';
import type { StreamTeam, TaggedItem } from './types';
import { cleanName } from '../grid/fleetGridModel';

/* ----------------------------------------------------------------------------
 * STREAM — the Monitor's DECISION log. One virtualized, read-only feed with
 * composable lenses. Absorbs the Teams Red Room and Team-memory panes.
 *
 * SCOPE: what was decided and what happened — steps, events, memories,
 * deliberation. Talk (channel messages, bridged Slack) is NOT in it; that is
 * Conversations' job, and mixing the two buried every decision under chatter.
 * `fetchKinds` never issues the blended read, so talk is not even fetched.
 *
 * THE LAYOUT ARGUMENT (the /prototype question, and its answer): five composable
 * lens dimensions — kind · event family · callsign · project · search — cannot
 * live in a header without turning it into a control panel. So they don't. The
 * header keeps what is genuinely global — the PROJECT scope (centered, the
 * app's universal selector), search, clear-all; every other lens lives in the
 * left TUNER rail, where it has vertical room to be a real faceted
 * browser: a group per dimension, each value a row with a LIVE COUNT.
 *
 * The counts are the point. Before you filter anything, the rail already tells
 * you what is IN the log — which event families exist, who the loudest personas
 * are, how much memory this team has accumulated. Each count is computed against
 * the rows surviving the OTHER dimensions, so "17" means "selecting this shows
 * 17 rows", not a misleading global total.
 *
 * READ-ONLY by design (D5): the composer and the Quick Answer rail that used to
 * live here belong to Conversations. One place to write, two places to watch.
 *
 * Density: one. The log is a log — a fixed 30px radio line. A second
 * "comfortable" height was prototyped and cut; it bought nothing the detail
 * modal doesn't do better, and it cost exact virtualizer math.
 * -------------------------------------------------------------------------- */

const FAMILY_DOT: Record<string, string> = {
  handoff: 'bg-violet-400', pr: 'bg-blue-400', qa: 'bg-amber-400', release: 'bg-emerald-400',
  failure: 'bg-red-400', build: 'bg-sky-400', note: 'bg-amber-300', other: 'bg-foreground/30',
};

/** One facet row: a value, a live count, on/off. */
function FacetRow({
  label, count, on, color, dot, dotColor, title, onClick,
}: {
  label: string;
  /** null = not counted (the value isn't in the current fetch — see Deliberation). */
  count: number | null;
  on: boolean;
  color?: string;
  dot?: string;
  dotColor?: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      disabled={count === 0 && !on}
      className={`w-full flex items-center gap-2 px-2 py-1 rounded-interactive text-left transition-colors disabled:opacity-30 ${
        on ? 'bg-primary/12 hover:bg-primary/18' : 'hover:bg-secondary/30'
      }`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />}
      {dotColor && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />}
      <span
        className={`typo-caption truncate ${on ? 'text-foreground' : 'text-foreground opacity-60'} ${color ? 'font-mono' : ''}`}
        style={color ? { color } : undefined}
      >
        {label}
      </span>
      <span className="ml-auto typo-caption tabular-nums text-foreground opacity-50 flex-shrink-0">
        {count === null ? '—' : count}
      </span>
    </button>
  );
}

function FacetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pb-2">
      <p className="hud-title px-2 pb-1 typo-label text-foreground opacity-45">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export interface StreamProps {
  teams: StreamTeam[];
  /** Scope the log to ONE team (the project filter's pick). */
  onSelectTeam: (teamId: string) => void;
  allOn: boolean;
  onSetAll: (on: boolean) => void;
  /** Deep-link scope: open with the callsign lens pre-set to this persona. */
  initialCallsign?: string;
  /** The Activity/Timeline/Conversations/Map switcher, rendered in THIS view's
   *  own header rather than above all of them — so the header row is one strip
   *  instead of two. Built by the header router in `PersonaMonitor` since
   *  `MonitorChannelGrid` was retired; each view only places it. */
  layoutControl?: ReactNode;
}

export function Stream({ teams, onSelectTeam, allOn, onSetAll, initialCallsign, layoutControl }: StreamProps) {
  const { t, tx } = useTranslation();
  const personaIndex = usePersonaIndex();
  const [lens, setLens] = useState<LensState>(() =>
    initialCallsign ? { ...EMPTY_LENS, callsigns: new Set([initialCallsign]) } : EMPTY_LENS,
  );
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);

  const selected = useMemo(() => teams.filter((t) => t.selected), [teams]);
  const { rows, loading, hasMore, loadMore, counts } = useLensFeed(selected, fetchKinds(lens));

  const nameOf = useCallback(
    (pid: string | null) => (pid ? personaIndex.get(pid)?.name : undefined),
    [personaIndex],
  );

  const visible = useMemo(() => rows.filter((r) => matchesLens(r, lens, nameOf)), [rows, lens, nameOf]);
  const facets = useMemo(() => facetCounts(rows, lens, nameOf), [rows, lens, nameOf]);

  const toggle = <T,>(field: 'kinds' | 'families' | 'callsigns', value: T) =>
    setLens((l) => {
      const next = new Set(l[field] as Set<T>);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...l, [field]: next } as LensState;
    });

  const setMemoryMode = (memoryMode: MemoryMode) => setLens((l) => ({ ...l, memoryMode }));
  /**
   * THE PROJECT FILTER. A team channel IS a dev project's team
   * (`dev_projects.team_id`), so the old Channel facet was a project filter
   * wearing team names. It is now the app's universal project selector, in
   * CONTROLLED mode: the pick scopes this log only and never moves the
   * app-wide active project, so the Stream always opens on the full log.
   *
   * Derived, not stored: the shown project is the one whose team is the sole
   * selected channel. That keeps it truthful when the map's drill-in scopes
   * the log to a team from outside.
   */
  const projects = useSystemStore((s) => s.projects);
  const teamIds = useMemo(() => new Set(teams.map((tm) => tm.teamId)), [teams]);
  const hasChannel = useCallback(
    (p: DevProject) => !!p.team_id && teamIds.has(p.team_id),
    [teamIds],
  );
  const projectId = useMemo(() => {
    if (allOn || selected.length !== 1) return null;
    return projects.find((p) => p.team_id === selected[0]!.teamId)?.id ?? null;
  }, [allOn, selected, projects]);
  const pickProject = (id: string | null) => {
    const team = id ? projects.find((p) => p.id === id)?.team_id : null;
    if (team) onSelectTeam(team);
    else onSetAll(true);
  };
  // A team scope with no project behind it (a map drill-in) still narrows the
  // log, so it counts as a lens and clear-all widens it back out.
  const scoped = !allOn;
  const clearAll = () => {
    setLens(EMPTY_LENS);
    if (scoped) onSetAll(true);
  };

  const active = activeLensCount(lens) + (scoped ? 1 : 0);
  const memoryModes = memoryModesAvailable(lens, selected.length);

  /**
   * Kind counts come from SQL, summed over the scoped teams — NOT from `rows`.
   * A facet cannot count what it never fetched: deliberation turns are absent
   * from the blended read (P1 made them opt-in so they'd stop leaking into the
   * conversation), so deriving this from loaded rows rendered "Deliberation 0"
   * for teams holding hundreds of them. `count_team_channel_kinds` counts where
   * the rows actually are.
   */
  const kindTotals = useMemo(() => {
    const totals: Partial<Record<ChannelKind, number>> = {};
    let any = false;
    for (const tm of selected) {
      const c = counts[tm.teamId];
      if (!c) continue;
      any = true;
      totals.step = (totals.step ?? 0) + c.step;
      totals.event = (totals.event ?? 0) + c.event;
      totals.memory = (totals.memory ?? 0) + c.memory;
      totals.deliberation = (totals.deliberation ?? 0) + c.deliberation;
    }
    return any ? totals : null;
  }, [selected, counts]);

  return (
    <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden hud-corners hud-bloom">
      {/* Header — ONLY what's global. No lens chips here, by design. */}
      <div className="flex-shrink-0 h-11 px-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 border-b border-border bg-foreground/[0.015]">
        <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-6 h-6 rounded-full bg-status-error/15 flex items-center justify-center flex-shrink-0">
          <Radio className="w-3.5 h-3.5 text-status-error" />
        </div>
        <span className="typo-body text-foreground">{t.monitor.stream_title}</span>
        <span className="typo-data text-foreground">
          {visible.length}
          {visible.length !== rows.length && <span className="opacity-40"> / {rows.length}</span>}
        </span>
        {loading && <span className="typo-caption text-foreground opacity-45">{t.monitor.stream_loading}</span>}
        </div>

        <WorkspaceProjectSelector
          value={projectId}
          onChange={pickProject}
          noneLabel={t.chrome.workspace_all_projects}
          projectFilter={hasChannel}
          align="center"
          testId="stream-project-filter"
        />

        <div className="flex items-center justify-end gap-2 min-w-0">
          {layoutControl}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground opacity-45 pointer-events-none" />
            <input
              value={lens.search}
              onChange={(e) => setLens((l) => ({ ...l, search: e.target.value }))}
              placeholder={t.monitor.stream_search}
              className="w-56 pl-7 pr-2 py-1 rounded-input bg-secondary/30 border border-border typo-caption text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
            />
          </div>
          {active > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-secondary/25 typo-caption text-foreground hover:bg-secondary/40 transition-colors"
            >
              <X className="w-3 h-3" />{' '}
              {tx(active === 1 ? t.monitor.stream_lens_one : t.monitor.stream_lens_other, { count: active })}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* THE TUNER — every lens dimension, with live counts. */}
        <div className="flex-shrink-0 w-[248px] border-r border-border bg-foreground/[0.012] overflow-y-auto p-2">
          <FacetGroup title={t.monitor.stream_group_kind}>
            {STREAM_KINDS.map((k) => {
              const Icon = KIND_META[k].icon;
              const on = lens.kinds.has(k);
              const total = kindTotals?.[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggle('kinds', k)}
                  aria-pressed={on}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded-interactive text-left transition-colors ${
                    on ? 'bg-primary/12 hover:bg-primary/18' : 'hover:bg-secondary/30'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 flex-shrink-0 text-foreground ${on ? '' : 'opacity-50'}`} />
                  <span className={`typo-caption text-foreground ${on ? '' : 'opacity-60'}`}>
                    {t.monitor[KIND_META[k].labelKey]}
                  </span>
                  <span className="ml-auto typo-caption tabular-nums text-foreground opacity-50">
                    {total ?? '·'}
                  </span>
                </button>
              );
            })}
          </FacetGroup>

          {/* Memory's analytical modes — only coherent for ONE team's memories (D2/D8). */}
          {memoryModes && (
            <FacetGroup title={t.monitor.stream_group_memory_view}>
              {(['list', 'timeline', 'diff'] as MemoryMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMemoryMode(m)}
                  aria-pressed={lens.memoryMode === m}
                  className={`w-full px-2 py-1 rounded-interactive text-left typo-caption capitalize text-foreground transition-colors ${
                    lens.memoryMode === m ? 'bg-primary/12' : 'opacity-60 hover:bg-secondary/30'
                  }`}
                >
                  {m === 'diff'
                    ? t.monitor.stream_memory_mode_diff
                    : m === 'timeline'
                      ? t.monitor.stream_memory_mode_timeline
                      : t.monitor.stream_memory_mode_list}
                </button>
              ))}
            </FacetGroup>
          )}

          {/* Kind counts are CORPUS totals (SQL). Family + callsign counts describe
              only the loaded window — they narrow rows already fetched. Different
              numbers meaning different things is exactly the kind of quiet lie
              this rail exists to avoid, so it says which is which. */}
          <p className="px-2 pb-1.5 typo-caption text-foreground opacity-40">
            {t.monitor.stream_facet_scope_note}
          </p>

          <FacetGroup title={t.monitor.stream_group_family}>
            {ALL_FAMILIES.map((fam: EventFamily) => {
              const f = facets.families.find((x) => x.key === fam)!;
              return (
                <FacetRow
                  key={fam}
                  label={fam}
                  count={f.count}
                  on={lens.families.has(fam)}
                  dot={FAMILY_DOT[fam]}
                  onClick={() => toggle('families', fam)}
                />
              );
            })}
          </FacetGroup>

          <FacetGroup title={t.monitor.stream_group_callsign}>
            {facets.callsigns.length === 0 && (
              <p className="px-2 typo-caption text-foreground opacity-40">{t.monitor.stream_no_speakers}</p>
            )}
            {facets.callsigns.filter((f) => personaIndex.has(f.key)).slice(0, 12).map((f) => {
              const persona = personaIndex.get(f.key);
              // The Red Room was single-team, so a callsign was unique. The
              // Stream is cross-team, and personas with the same name in
              // different teams collapse to the SAME callsign — so carry the
              // home team's colour as a dot and the full identity in the title.
              const home = teams.find((tm) => tm.teamId === persona?.home_team_id);
              return (
                <FacetRow
                  key={f.key}
                  label={callsign(persona?.name)}
                  count={f.count}
                  on={lens.callsigns.has(f.key)}
                  color={memberColor(persona, f.key)}
                  dotColor={home?.teamColor}
                  title={home ? `${persona?.name ?? f.key} — ${cleanName(home.teamName)}` : persona?.name}
                  onClick={() => toggle('callsigns', f.key)}
                />
              );
            })}
            {/* The speakers that are not a persona — ONE row each, below the
                named ones, instead of a "SYSTEM" row per unresolved id. Voiced
                keys (__athena__ …) only occur if talk ever reaches the log. */}
            {facets.callsigns.filter((f) => !personaIndex.has(f.key)).map((f) => {
              const named =
                f.key === SPEAKER_REMOVED ? [t.monitor.stream_speaker_removed, t.monitor.stream_speaker_removed_hint]
                  : f.key === SPEAKER_SYSTEM ? [t.monitor.stream_speaker_system, t.monitor.stream_speaker_system_hint]
                    : [callsign(f.key.replace(/_/g, ' ').trim()), undefined];
              return (
                <FacetRow
                  key={f.key}
                  label={named[0]!}
                  count={f.count}
                  on={lens.callsigns.has(f.key)}
                  title={named[1]}
                  onClick={() => toggle('callsigns', f.key)}
                />
              );
            })}
          </FacetGroup>

        </div>

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {memoryModes && lens.memoryMode !== 'list' && selected[0] ? (
            <StreamMemoryViews
              teamId={selected[0].teamId}
              mode={lens.memoryMode}
              onExit={() => setMemoryMode('list')}
            />
          ) : (
            <LensStream
              rows={visible}
              onOpen={(r: TaggedItem) => setDetail(r.item)}
              onAssignment={(id) => setLens((l) => ({ ...l, search: id }))}
              emptyLabel={active > 0 ? t.monitor.stream_empty_filtered : t.monitor.stream_empty}
              hasMore={hasMore}
              onEndReached={loadMore}
            />
          )}
        </div>
      </div>

      <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

export default Stream;
