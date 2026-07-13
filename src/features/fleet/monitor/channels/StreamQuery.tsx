/* eslint-disable custom/no-hardcoded-jsx-text -- prototype variant; i18n lands at consolidation (plan P6). */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Radio, X, Rows3, Rows4, CornerDownLeft } from 'lucide-react';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import { memberColor, type EventFamily } from '@/lib/channel/eventModel';
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
 * VARIANT B — "QUERY" (the command bar).
 *
 * Metaphor: a mail client / issue search (`is:open label:bug author:me`). The
 * opposite bet to Console: five lens dimensions don't fit in a header, so DON'T
 * MAKE THEM PERSISTENT CHROME AT ALL. There is no rail. One command bar owns
 * every dimension — you type, a suggestion menu offers the completions that
 * exist in the current feed, and Enter commits the lens as a removable CHIP.
 *
 * Everything else on screen is log. That's the argument for this direction: the
 * stream is the product, and filters are a transient act, not furniture. A user
 * who never filters sees a full-bleed log and zero controls.
 *
 * Grammar (typed or clicked):  kind:memory  family:failure  @qa-guardian
 *                              #ai-bookkeeper  free text
 *
 * Trade-off it accepts: no facet counts, so the log is less *discoverable* —
 * you must know (or be suggested) that "family:failure" is a thing. The
 * suggestion menu is what has to carry that weight.
 * -------------------------------------------------------------------------- */

const FAMILY_DOT: Record<string, string> = {
  handoff: 'bg-violet-400', pr: 'bg-blue-400', qa: 'bg-amber-400', release: 'bg-emerald-400',
  failure: 'bg-red-400', build: 'bg-sky-400', note: 'bg-amber-300', other: 'bg-foreground/30',
};

type Suggestion =
  | { type: 'kind'; value: ChannelKind; label: string; count: number }
  | { type: 'family'; value: EventFamily; label: string; count: number }
  | { type: 'callsign'; value: string; label: string; count: number; color: string }
  | { type: 'team'; value: string; label: string; count: number; color: string };

/** A committed lens, shown as a removable chip in the bar. */
function Chip({ label, dot, color, onRemove }: { label: string; dot?: string; color?: string; onRemove: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full border border-primary/25 bg-primary/10 typo-caption text-foreground flex-shrink-0"
      style={color ? { color } : undefined}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      <span className="font-mono">{label}</span>
      <button type="button" onClick={onRemove} className="p-0.5 rounded-full hover:bg-secondary/50 transition-colors" aria-label={`Remove ${label}`}>
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

export function StreamQuery({
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
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => teams.filter((t) => t.selected), [teams]);
  const { rows, loading } = useLensFeed(selected, fetchKinds(lens));

  const nameOf = useCallback(
    (pid: string | null) => (pid ? personaIndex.get(pid)?.name : undefined),
    [personaIndex],
  );

  const visible = useMemo(() => rows.filter((r) => matchesLens(r, lens, nameOf)), [rows, lens, nameOf]);
  const facets = useMemo(() => facetCounts(rows, lens, nameOf), [rows, lens, nameOf]);

  const teamCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.team.teamId, (m.get(r.team.teamId) ?? 0) + 1);
    return m;
  }, [rows]);

  /** What the typed prefix could become. This menu IS the discoverability. */
  const suggestions = useMemo<Suggestion[]>(() => {
    const q = draft.trim().toLowerCase();
    const out: Suggestion[] = [];

    for (const k of ALL_KINDS) {
      if (lens.kinds.has(k)) continue;
      const count = facets.kinds.find((x) => x.key === k)?.count ?? 0;
      if (!q || `kind:${k}`.includes(q)) out.push({ type: 'kind', value: k, label: `kind:${k}`, count });
    }
    for (const f of ALL_FAMILIES) {
      if (lens.families.has(f)) continue;
      const count = facets.families.find((x) => x.key === f)?.count ?? 0;
      if (count === 0) continue;
      if (!q || `family:${f}`.includes(q)) out.push({ type: 'family', value: f, label: `family:${f}`, count });
    }
    for (const c of facets.callsigns.slice(0, 10)) {
      if (lens.callsigns.has(c.key)) continue;
      const persona = personaIndex.get(c.key);
      const sign = callsign(persona?.name);
      if (!q || `@${sign}`.toLowerCase().includes(q)) {
        out.push({ type: 'callsign', value: c.key, label: `@${sign}`, count: c.count, color: memberColor(persona, c.key) });
      }
    }
    for (const tm of teams) {
      if (tm.selected) continue;
      const name = tm.teamName.replace(/^SDLC[ —-]*/i, '') || tm.teamName;
      if (!q || `#${name}`.toLowerCase().includes(q)) {
        out.push({ type: 'team', value: tm.teamId, label: `#${name}`, count: teamCount.get(tm.teamId) ?? 0, color: tm.teamColor });
      }
    }
    return out.slice(0, 8);
  }, [draft, facets, lens, personaIndex, teams, teamCount]);

  const commit = (s: Suggestion) => {
    setLens((l) => {
      if (s.type === 'kind') { const n = new Set(l.kinds); n.add(s.value); return { ...l, kinds: n }; }
      if (s.type === 'family') { const n = new Set(l.families); n.add(s.value); return { ...l, families: n }; }
      if (s.type === 'callsign') { const n = new Set(l.callsigns); n.add(s.value); return { ...l, callsigns: n }; }
      return l;
    });
    if (s.type === 'team') onToggle(s.value);
    setDraft('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions[0]) commit(suggestions[0]);
      else setLens((l) => ({ ...l, search: draft.trim() })); // no token matched → free text
      return;
    }
    if (e.key === 'Backspace' && !draft) {
      // Pop the most recent chip — the mail-client reflex.
      setLens((l) => {
        if (l.search) return { ...l, search: '' };
        if (l.callsigns.size) { const n = new Set(l.callsigns); n.delete([...n].pop()!); return { ...l, callsigns: n }; }
        if (l.families.size) { const n = new Set(l.families); n.delete([...n].pop()!); return { ...l, families: n }; }
        if (l.kinds.size) { const n = new Set(l.kinds); n.delete([...n].pop()!); return { ...l, kinds: n }; }
        return l;
      });
    }
  };

  const setDensity = (density: Density) => setLens((l) => ({ ...l, density }));
  const setMemoryMode = (memoryMode: MemoryMode) => setLens((l) => ({ ...l, memoryMode }));
  const active = activeLensCount(lens);
  const memoryModes = memoryModesAvailable(lens, selected.length);

  const drop = <T,>(field: 'kinds' | 'families' | 'callsigns', v: T) =>
    setLens((l) => {
      const n = new Set(l[field] as Set<T>);
      n.delete(v);
      return { ...l, [field]: n } as LensState;
    });

  return (
    <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
      {/* ONE bar. Chips + input + density. No rail, no filter row. */}
      <div className="relative flex-shrink-0 px-3 py-2 border-b border-border bg-foreground/[0.015]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-status-error/15 flex items-center justify-center flex-shrink-0">
            <Radio className="w-3.5 h-3.5 text-status-error" />
          </div>

          <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap px-2 py-1 rounded-input bg-secondary/25 border border-border focus-within:border-primary/40 transition-colors">
            {[...lens.kinds].map((k) => (
              <Chip key={`k-${k}`} label={`kind:${k}`} onRemove={() => drop('kinds', k)} />
            ))}
            {[...lens.families].map((f) => (
              <Chip key={`f-${f}`} label={`family:${f}`} dot={FAMILY_DOT[f]} onRemove={() => drop('families', f)} />
            ))}
            {[...lens.callsigns].map((c) => {
              const persona = personaIndex.get(c);
              return (
                <Chip
                  key={`c-${c}`}
                  label={`@${callsign(persona?.name)}`}
                  color={memberColor(persona, c)}
                  onRemove={() => drop('callsigns', c)}
                />
              );
            })}
            {selected.length < teams.length &&
              selected.map((tm) => (
                <Chip
                  key={`t-${tm.teamId}`}
                  label={`#${tm.teamName.replace(/^SDLC[ —-]*/i, '') || tm.teamName}`}
                  color={tm.teamColor}
                  onRemove={() => onToggle(tm.teamId)}
                />
              ))}
            {lens.search && <Chip label={`"${lens.search}"`} onRemove={() => setLens((l) => ({ ...l, search: '' }))} />}

            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 120)}
              onKeyDown={onKeyDown}
              placeholder={active === 0 ? 'Filter the stream — kind:, family:, @callsign, #channel, or free text' : ''}
              className="flex-1 min-w-[12rem] bg-transparent typo-caption text-foreground placeholder:text-foreground/35 focus:outline-none py-0.5"
            />
          </div>

          <span className="typo-data text-foreground/70 tabular-nums flex-shrink-0">
            {visible.length}
            {visible.length !== rows.length && <span className="text-foreground/35"> / {rows.length}</span>}
          </span>
          {loading && <span className="typo-caption text-foreground/40 flex-shrink-0">loading…</span>}

          <div className="flex items-center gap-0.5 rounded-full bg-secondary/20 p-0.5 flex-shrink-0">
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
          {layoutControl}
        </div>

        {/* The suggestion menu carries ALL the discoverability in this direction. */}
        {open && suggestions.length > 0 && (
          <div className="absolute left-11 right-3 top-full mt-1 z-30 rounded-card border border-border bg-background shadow-elevation-3 p-1 max-h-72 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={s.label}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commit(s); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-interactive text-left transition-colors ${
                  i === 0 ? 'bg-primary/10' : 'hover:bg-secondary/40'
                }`}
              >
                {s.type === 'family' && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${FAMILY_DOT[s.value]}`} />}
                <span
                  className="typo-caption font-mono truncate"
                  style={'color' in s ? { color: s.color } : undefined}
                >
                  {s.label}
                </span>
                <span className="ml-auto typo-caption tabular-nums text-foreground/40 flex-shrink-0">{s.count}</span>
                {i === 0 && <CornerDownLeft className="w-3 h-3 text-foreground/35 flex-shrink-0" />}
              </button>
            ))}
          </div>
        )}

        {/* Memory's analytical modes surface inline, only when they're coherent. */}
        {memoryModes && (
          <div className="mt-1.5 flex items-center gap-1 pl-11">
            {(['list', 'timeline', 'diff'] as MemoryMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMemoryMode(m)}
                aria-pressed={lens.memoryMode === m}
                className={`px-2 py-0.5 rounded-full typo-caption capitalize transition-colors ${
                  lens.memoryMode === m ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground/45 hover:text-foreground/80'
                }`}
              >
                {m === 'diff' ? 'Run diff' : m}
              </button>
            ))}
          </div>
        )}
      </div>

      <LensStream
        rows={visible}
        density={lens.density}
        onOpen={(r: TaggedItem) => setDetail(r.item)}
        emptyLabel={active > 0 ? 'No transmissions match this query.' : 'No transmissions in these channels yet.'}
      />

      <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
