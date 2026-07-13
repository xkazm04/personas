/* eslint-disable custom/no-hardcoded-jsx-text -- prototype variant; i18n lands at consolidation (plan P6). */
import { useCallback, useMemo, useState } from 'react';
import { Radio, Search, X, Rows3, Rows4, Layers, Users, Signal, Brain } from 'lucide-react';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import { memberColor } from '@/lib/channel/eventModel';
import type { EventFamily } from '@/lib/channel/eventModel';
import type { ChannelKind } from '@/api/pipeline/teamChannel';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { LensStream } from './LensStream';
import { useLensFeed } from './useLensFeed';
import {
  ALL_FAMILIES, ALL_KINDS, EMPTY_LENS, activeLensCount, callsign, facetCounts, fetchKinds,
  matchesLens, memoryModesAvailable, type Density, type LensState, type MemoryMode,
} from './lensModel';
import type { WorkspaceTeam } from './ChannelTimelineWorkspace';
import type { TaggedItem } from './types';

/* ----------------------------------------------------------------------------
 * VARIANT A — "CONSOLE" (the facet rail).
 *
 * Metaphor: a signals console / log-search tool (Splunk, Kibana). The design
 * problem is that five composable lens dimensions cannot live in a header
 * without becoming a control panel — so this direction says: DON'T PUT THEM
 * THERE. The header keeps only what's global (search, density, clear). Every
 * lens moves into a left TUNER rail where it has vertical room to be a proper
 * faceted browser: a labelled group per dimension, each row a value with a LIVE
 * COUNT, click to toggle.
 *
 * The counts are the whole argument for this direction. A facet count answers
 * "what is in this log, and how much of it?" before you've filtered anything —
 * you discover the 8 event families and the loudest personas by reading the
 * rail. Each count is computed against the rows surviving the OTHER dimensions,
 * so it means "selecting this shows N rows", not a misleading global total.
 *
 * Trade-off it accepts: the rail costs ~260px of horizontal space permanently,
 * and the log is never full-bleed.
 * -------------------------------------------------------------------------- */

const FAMILY_DOT: Record<string, string> = {
  handoff: 'bg-violet-400', pr: 'bg-blue-400', qa: 'bg-amber-400', release: 'bg-emerald-400',
  failure: 'bg-red-400', build: 'bg-sky-400', note: 'bg-amber-300', other: 'bg-foreground/30',
};

const KIND_META: Record<ChannelKind, { label: string; icon: typeof Layers }> = {
  step: { label: 'Steps', icon: Layers },
  event: { label: 'Events', icon: Signal },
  memory: { label: 'Memory', icon: Brain },
  message: { label: 'Messages', icon: Users },
  deliberation: { label: 'Deliberation', icon: Radio },
};

/** One facet row: a value, a live count, on/off. */
function FacetRow({
  label, count, on, color, dot, onClick,
}: {
  label: string; count: number; on: boolean; color?: string; dot?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      disabled={count === 0 && !on}
      className={`w-full flex items-center gap-2 px-2 py-1 rounded-interactive text-left transition-colors disabled:opacity-30 ${
        on ? 'bg-primary/12 hover:bg-primary/18' : 'hover:bg-secondary/30'
      }`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />}
      <span
        className={`typo-caption truncate ${on ? 'text-foreground font-medium' : 'text-foreground/60'} ${color ? 'font-mono' : ''}`}
        style={color ? { color } : undefined}
      >
        {label}
      </span>
      <span className="ml-auto typo-caption tabular-nums text-foreground/40 flex-shrink-0">{count}</span>
    </button>
  );
}

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pb-2">
      <p className="px-2 pb-1 typo-label uppercase tracking-wider text-foreground/40">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function StreamConsole({
  teams, onToggle, layoutControl,
}: {
  teams: WorkspaceTeam[];
  onToggle: (teamId: string) => void;
  allOn: boolean;
  onSetAll: (on: boolean) => void;
  layoutControl?: React.ReactNode;
}) {
  const personaIndex = usePersonaIndex();
  const [lens, setLens] = useState<LensState>(EMPTY_LENS);
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);

  const selected = useMemo(() => teams.filter((t) => t.selected), [teams]);
  const { rows, loading } = useLensFeed(selected, fetchKinds(lens));

  const nameOf = useCallback(
    (pid: string | null) => (pid ? personaIndex.get(pid)?.name : undefined),
    [personaIndex],
  );

  const visible = useMemo(
    () => rows.filter((r) => matchesLens(r, lens, nameOf)),
    [rows, lens, nameOf],
  );
  const facets = useMemo(() => facetCounts(rows, lens, nameOf), [rows, lens, nameOf]);

  const toggle = <T,>(field: 'kinds' | 'families' | 'callsigns', value: T) =>
    setLens((l) => {
      const next = new Set(l[field] as Set<T>);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...l, [field]: next } as LensState;
    });

  const setDensity = (density: Density) => setLens((l) => ({ ...l, density }));
  const setMemoryMode = (memoryMode: MemoryMode) => setLens((l) => ({ ...l, memoryMode }));
  const clearAll = () => setLens((l) => ({ ...EMPTY_LENS, density: l.density }));

  const active = activeLensCount(lens);
  const memoryModes = memoryModesAvailable(lens, selected.length);

  const teamCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.team.teamId, (m.get(r.team.teamId) ?? 0) + 1);
    return m;
  }, [rows]);

  return (
    <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
      {/* Header — ONLY what's global. No lens chips here, by design. */}
      <div className="flex-shrink-0 h-11 px-3 flex items-center gap-2.5 border-b border-border bg-foreground/[0.015]">
        <div className="w-6 h-6 rounded-full bg-status-error/15 flex items-center justify-center flex-shrink-0">
          <Radio className="w-3.5 h-3.5 text-status-error" />
        </div>
        <span className="typo-body font-semibold text-foreground">Stream</span>
        <span className="typo-data text-foreground/70 tabular-nums">
          {visible.length}{visible.length !== rows.length && <span className="text-foreground/35"> / {rows.length}</span>}
        </span>
        {loading && <span className="typo-caption text-foreground/40">loading…</span>}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40 pointer-events-none" />
            <input
              value={lens.search}
              onChange={(e) => setLens((l) => ({ ...l, search: e.target.value }))}
              placeholder="Search transmissions"
              className="w-56 pl-7 pr-2 py-1 rounded-input bg-secondary/30 border border-border typo-caption text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
            />
          </div>
          <div className="flex items-center gap-0.5 rounded-full bg-secondary/20 p-0.5">
            <button
              type="button" onClick={() => setDensity('radio')} aria-pressed={lens.density === 'radio'} title="Radio (dense)"
              className={`p-1 rounded-full transition-colors ${lens.density === 'radio' ? 'bg-primary/15 text-foreground' : 'text-foreground/45 hover:text-foreground/80'}`}
            >
              <Rows4 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button" onClick={() => setDensity('comfortable')} aria-pressed={lens.density === 'comfortable'} title="Comfortable"
              className={`p-1 rounded-full transition-colors ${lens.density === 'comfortable' ? 'bg-primary/15 text-foreground' : 'text-foreground/45 hover:text-foreground/80'}`}
            >
              <Rows3 className="w-3.5 h-3.5" />
            </button>
          </div>
          {active > 0 && (
            <button
              type="button" onClick={clearAll}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-secondary/25 typo-caption text-foreground/70 hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" /> {active} lens{active > 1 ? 'es' : ''}
            </button>
          )}
          {layoutControl}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* THE TUNER — every lens dimension, with live counts. */}
        <div className="flex-shrink-0 w-[248px] border-r border-border bg-foreground/[0.012] overflow-y-auto p-2">
          <FacetGroup title="Kind">
            {ALL_KINDS.map((k) => {
              const f = facets.kinds.find((x) => x.key === k)!;
              const Icon = KIND_META[k].icon;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggle('kinds', k)}
                  aria-pressed={lens.kinds.has(k)}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded-interactive text-left transition-colors ${
                    lens.kinds.has(k) ? 'bg-primary/12 hover:bg-primary/18' : 'hover:bg-secondary/30'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${lens.kinds.has(k) ? 'text-foreground' : 'text-foreground/45'}`} />
                  <span className={`typo-caption ${lens.kinds.has(k) ? 'text-foreground font-medium' : 'text-foreground/60'}`}>
                    {KIND_META[k].label}
                  </span>
                  <span className="ml-auto typo-caption tabular-nums text-foreground/40">{f.count}</span>
                </button>
              );
            })}
          </FacetGroup>

          {/* Memory's analytical modes — only coherent for ONE team's memories. */}
          {memoryModes && (
            <FacetGroup title="Memory view">
              {(['list', 'timeline', 'diff'] as MemoryMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMemoryMode(m)}
                  aria-pressed={lens.memoryMode === m}
                  className={`w-full px-2 py-1 rounded-interactive text-left typo-caption capitalize transition-colors ${
                    lens.memoryMode === m ? 'bg-primary/12 text-foreground font-medium' : 'text-foreground/60 hover:bg-secondary/30'
                  }`}
                >
                  {m === 'diff' ? 'Run diff' : m}
                </button>
              ))}
            </FacetGroup>
          )}

          <FacetGroup title="Event family">
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

          <FacetGroup title="Callsign">
            {facets.callsigns.length === 0 && <p className="px-2 typo-caption text-foreground/35">No speakers</p>}
            {facets.callsigns.slice(0, 12).map((f) => {
              const persona = personaIndex.get(f.key);
              return (
                <FacetRow
                  key={f.key}
                  label={callsign(persona?.name)}
                  count={f.count}
                  on={lens.callsigns.has(f.key)}
                  color={memberColor(persona, f.key)}
                  onClick={() => toggle('callsigns', f.key)}
                />
              );
            })}
          </FacetGroup>

          <FacetGroup title="Channel">
            {teams.map((tm) => (
              <FacetRow
                key={tm.teamId}
                label={tm.teamName.replace(/^SDLC[ —-]*/i, '') || tm.teamName}
                count={teamCount.get(tm.teamId) ?? 0}
                on={tm.selected}
                dot=""
                color={tm.selected ? tm.teamColor : undefined}
                onClick={() => onToggle(tm.teamId)}
              />
            ))}
          </FacetGroup>
        </div>

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <LensStream
            rows={visible}
            density={lens.density}
            onOpen={(r: TaggedItem) => setDetail(r.item)}
            emptyLabel={active > 0 ? 'No transmissions match this lens.' : 'No transmissions in these channels yet.'}
          />
        </div>
      </div>

      <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
