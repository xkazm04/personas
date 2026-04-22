/**
 * useRoutingFilters — all filter/sort state + the derived render-ready
 * group list, pulled out of the view so <RoutingView /> stays under budget.
 *
 * Kept deliberately simple: state lives in plain useState; derived values
 * are useMemo'd. No reducer, no context — the state fan-out is ~8 fields
 * and consumed in one place.
 */
import { useMemo, useState } from 'react';
import type { Persona } from '@/lib/bindings/Persona';
import type { EventRow } from '../routingHelpers';
import { buildActivityMap } from './activity';
import { groupRows, sortRows } from './groupRows';
import type { GroupDef, SortMode } from './types';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';

type ClassKey = 'persona' | 'common' | 'external';

export interface SourceOption { value: string; label: string }

interface Args {
  rows: EventRow[];
  recentEvents: PersonaEvent[];
  personaMap: Map<string, Persona>;
}

export interface RoutingFilters {
  search: string; setSearch: (v: string) => void;
  sourceFilter: string; setSourceFilter: (v: string) => void;
  activeOnly: boolean; setActiveOnly: (v: boolean) => void;
  showUnconnected: boolean; setShowUnconnected: (v: boolean) => void;
  visibleClasses: Set<ClassKey>; toggleClass: (c: ClassKey) => void;
  sortMode: SortMode; setSortMode: (m: SortMode) => void;

  classCounts: Record<ClassKey, number>;
  sourceOptions: SourceOption[];
  unconnectedCount: number;
  visibleRows: EventRow[];
  groupsList: GroupDef[];
  filterKey: string;
  totalConnections: number;
}

export function useRoutingFilters({ rows, recentEvents, personaMap }: Args): RoutingFilters {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [showUnconnected, setShowUnconnected] = useState(false);
  const [visibleClasses, setVisibleClasses] = useState<Set<ClassKey>>(
    () => new Set(['persona', 'common', 'external']),
  );
  const [sortMode, setSortMode] = useState<SortMode>('activity');

  const toggleClass = (c: ClassKey) => setVisibleClasses(prev => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next;
  });

  const activity = useMemo(() => buildActivityMap(recentEvents), [recentEvents]);

  const classCounts = useMemo(() => {
    const c: Record<ClassKey, number> = { persona: 0, common: 0, external: 0 };
    for (const r of rows) c[r.sourceClass] += 1;
    return c;
  }, [rows]);

  const sourceOptions = useMemo<SourceOption[]>(() => {
    const opts: SourceOption[] = [
      { value: 'all', label: 'All Sources' },
      { value: 'common', label: 'Common (SYS)' },
    ];
    const personaSources = new Set<string>();
    for (const row of rows) for (const s of row.sourcePersonas) personaSources.add(s.personaId);
    const personaItems: SourceOption[] = [];
    for (const pid of personaSources) {
      const p = personaMap.get(pid);
      if (p) personaItems.push({ value: p.id, label: p.name });
    }
    personaItems.sort((a, b) => a.label.localeCompare(b.label));
    return [...opts, ...personaItems];
  }, [rows, personaMap]);

  const visibleRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter(r => {
      if (!visibleClasses.has(r.sourceClass)) return false;
      if (!showUnconnected && r.connections.length === 0) return false;
      if (sourceFilter === 'common' && r.sourceClass !== 'common') return false;
      if (sourceFilter !== 'all' && sourceFilter !== 'common') {
        if (!r.sourcePersonas.some(s => s.personaId === sourceFilter)) return false;
      }
      if (activeOnly) {
        const a = activity.get(r.eventType);
        if (!a || a.lastTs === null || Date.now() - a.lastTs > 60 * 60 * 1000) return false;
      }
      if (q) {
        const label = (r.template?.label ?? r.eventType).toLowerCase();
        if (!label.includes(q) && !r.eventType.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, activeOnly, showUnconnected, visibleClasses, sourceFilter, activity]);

  const unconnectedCount = useMemo(
    () => rows.filter(r => visibleClasses.has(r.sourceClass) && r.connections.length === 0).length,
    [rows, visibleClasses],
  );

  const groupsList = useMemo(() => {
    const gs = groupRows(visibleRows);
    for (const g of gs) g.rows = sortRows(g.rows, sortMode, activity);
    return gs;
  }, [visibleRows, sortMode, activity]);

  const filterKey = useMemo(
    () => `${sortMode}|${search}|${sourceFilter}|${activeOnly ? 1 : 0}|${showUnconnected ? 1 : 0}|${[...visibleClasses].sort().join(',')}`,
    [sortMode, search, sourceFilter, activeOnly, showUnconnected, visibleClasses],
  );

  const totalConnections = useMemo(
    () => rows.reduce((sum, r) => sum + r.connections.length, 0),
    [rows],
  );

  return {
    search, setSearch,
    sourceFilter, setSourceFilter,
    activeOnly, setActiveOnly,
    showUnconnected, setShowUnconnected,
    visibleClasses, toggleClass,
    sortMode, setSortMode,
    classCounts, sourceOptions, unconnectedCount,
    visibleRows, groupsList, filterKey, totalConnections,
  };
}

export { buildActivityMap } from './activity';
