/**
 * Modal for adding personas to the event routing matrix.
 * Features: search, group filtering, categorization.
 */
import { useMemo, useState } from 'react';
import { Bot, Search, X, Plus, Users } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaGroup } from '@/lib/bindings/PersonaGroup';

interface Props {
  open: boolean;
  personas: Persona[];
  groups: PersonaGroup[];
  alreadyActiveIds: Set<string>;
  eventLabel?: string;
  onAdd: (personaId: string) => void;
  onClose: () => void;
}

export function AddPersonaModal({ open, personas, groups, alreadyActiveIds, eventLabel, onAdd, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const groupMap = useMemo(() => {
    const m = new Map<string, PersonaGroup>();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);

  // Groups that have personas available
  const groupsWithPersonas = useMemo(() => {
    const groupIds = new Set<string>();
    for (const p of personas) {
      if (p.group_id && !alreadyActiveIds.has(p.id)) groupIds.add(p.group_id);
    }
    return groups.filter(g => groupIds.has(g.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [groups, personas, alreadyActiveIds]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return personas.filter(p => {
      if (alreadyActiveIds.has(p.id)) return false;
      if (selectedGroupId && p.group_id !== selectedGroupId) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.description ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [personas, alreadyActiveIds, selectedGroupId, search]);

  // Group the filtered results
  const grouped = useMemo(() => {
    const buckets = new Map<string | null, Persona[]>();
    for (const p of filtered) {
      const key = p.group_id;
      const arr = buckets.get(key) ?? [];
      arr.push(p);
      buckets.set(key, arr);
    }
    // Sort groups by sortOrder, ungrouped last
    const entries: { group: PersonaGroup | null; personas: Persona[] }[] = [];
    const sortedGroupIds = groups.sort((a, b) => a.sortOrder - b.sortOrder).map(g => g.id);
    for (const gid of sortedGroupIds) {
      const ps = buckets.get(gid);
      if (ps?.length) entries.push({ group: groupMap.get(gid) ?? null, personas: ps });
    }
    const ungrouped = buckets.get(null);
    if (ungrouped?.length) entries.push({ group: null, personas: ungrouped });
    return entries;
  }, [filtered, groups, groupMap]);

  if (!open) return null;

  const availableCount = personas.filter(p => !alreadyActiveIds.has(p.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-[520px] max-h-[70vh] flex flex-col rounded-2xl bg-card border border-primary/15 shadow-elevation-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-primary/10">
          <Users className="w-4 h-4 text-emerald-400" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">
              {eventLabel ? `Connect persona to "${eventLabel}"` : 'Add Persona'}
            </h3>
            <p className="text-[10px] text-muted-foreground/60">{availableCount} available</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary/60 text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + filters */}
        <div className="px-4 py-2.5 border-b border-primary/5 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search personas..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-secondary/30 border border-primary/10 rounded-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-cyan-400/40"
              autoFocus
            />
          </div>

          {groupsWithPersonas.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setSelectedGroupId(null)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${!selectedGroupId ? 'bg-cyan-500/15 text-cyan-400' : 'text-muted-foreground/60 hover:text-foreground hover:bg-secondary/40'}`}
              >
                All
              </button>
              {groupsWithPersonas.map(g => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGroupId(selectedGroupId === g.id ? null : g.id)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${selectedGroupId === g.id ? 'bg-cyan-500/15 text-cyan-400' : 'text-muted-foreground/60 hover:text-foreground hover:bg-secondary/40'}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.color }} />
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Persona list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
          {grouped.length === 0 && (
            <div className="text-center py-8 text-xs text-muted-foreground/50">
              {search ? 'No matching personas found' : 'All personas are already connected'}
            </div>
          )}

          {grouped.map(({ group, personas: ps }) => (
            <div key={group?.id ?? 'ungrouped'} className="mb-2">
              {/* Group header (only when not filtering by group) */}
              {!selectedGroupId && (
                <div className="flex items-center gap-1.5 px-2 py-1">
                  {group ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: group.color }} />
                      <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{group.name}</span>
                    </>
                  ) : (
                    <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Ungrouped</span>
                  )}
                  <span className="text-[9px] text-muted-foreground/30 ml-auto">{ps.length}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-1">
                {ps.map(p => (
                  <button
                    key={p.id}
                    onClick={() => onAdd(p.id)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-card/50 border border-primary/8 hover:border-emerald-400/40 hover:bg-emerald-500/5 transition-colors text-left group"
                  >
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 flex-shrink-0">
                      {p.icon ? <span className="text-sm">{p.icon}</span> : <Bot className="w-3.5 h-3.5 text-muted-foreground/40" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-foreground truncate">{p.name}</div>
                      {p.description && (
                        <div className="text-[9px] text-muted-foreground/50 truncate">{p.description}</div>
                      )}
                    </div>
                    <Plus className="w-3 h-3 text-emerald-400/40 group-hover:text-emerald-400 transition-colors flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
