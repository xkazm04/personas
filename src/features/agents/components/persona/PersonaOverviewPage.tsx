import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Bot, Zap, Clock, Loader2, MoreHorizontal, Trash2, Settings, Star, Plug } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { extractConnectorNames } from '@/lib/personas/utils';
import { useFavoriteAgents } from '@/hooks/agents/useFavoriteAgents';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';

// -- Status helpers --

const HEALTH_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  healthy:  { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Healthy' },
  degraded: { bg: 'bg-amber-500/10',   text: 'text-amber-400',   label: 'Degraded' },
  failing:  { bg: 'bg-red-500/10',     text: 'text-red-400',     label: 'Failing' },
};

function StatusBadge({ enabled, health, isDraft }: { enabled: boolean; health?: PersonaHealth; isDraft: boolean }) {
  if (isDraft) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/15">
        Draft
      </span>
    );
  }
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/15">
        Disabled
      </span>
    );
  }
  const healthStatus = health?.status ?? 'healthy';
  const style = (HEALTH_STYLES[healthStatus] ?? HEALTH_STYLES.healthy)!;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${style.bg} ${style.text} border border-current/15`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {style.label}
    </span>
  );
}

function BuildingBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-500/10 text-violet-400 border border-violet-500/15">
      <Loader2 className="w-3 h-3 animate-spin" />
      Building
    </span>
  );
}

// -- Row action menu --

function RowActionMenu({ persona, onDelete, onEdit }: {
  persona: Persona;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 rounded-md hover:bg-secondary/40 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-primary/15 bg-background shadow-xl shadow-black/20 py-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(persona.id); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground/70 hover:bg-secondary/40 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(persona.id); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-400/80 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// -- Batch action bar --

function BatchActionBar({ count, onDelete, onClear }: {
  count: number;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-3 px-4 py-2 rounded-xl border border-primary/15 bg-secondary/40 backdrop-blur-sm"
        >
          <span className="text-sm text-foreground/80 font-medium">
            {count} selected
          </span>
          <div className="w-px h-4 bg-primary/15" />
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
          <button
            type="button"
            onClick={onClear}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-muted-foreground/70 hover:bg-secondary/60 transition-colors"
          >
            Clear
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// -- Main component --

export default function PersonaOverviewPage() {
  const personas = useAgentStore((s) => s.personas);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const deletePersona = useAgentStore((s) => s.deletePersona);
  const triggerCounts = useAgentStore((s) => s.personaTriggerCounts);
  const lastRunMap = useAgentStore((s) => s.personaLastRun);
  const healthMap = useAgentStore((s) => s.personaHealthMap);
  const buildPersonaId = useAgentStore((s) => s.buildPersonaId);
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const setIsCreatingPersona = useSystemStore((s) => s.setIsCreatingPersona);
  const { toggleFavorite, isFavorite } = useFavoriteAgents();

  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<string | null>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Detect if a persona is an incomplete draft (system_prompt is default placeholder)
  const isDraft = useCallback((persona: Persona) => {
    return persona.system_prompt === 'You are a helpful AI assistant.' || !persona.system_prompt?.trim();
  }, []);

  // Check if a persona has an active build session
  const isBuilding = useCallback((id: string) => {
    return id === buildPersonaId && buildPhase !== 'initializing' && buildPhase !== 'promoted';
  }, [buildPersonaId, buildPhase]);

  const handleRowClick = useCallback((persona: Persona) => {
    // Building or draft personas → open PersonaMatrix
    if (isBuilding(persona.id) || isDraft(persona)) {
      useAgentStore.setState({ buildPersonaId: persona.id });
      setIsCreatingPersona(true);
    } else {
      selectPersona(persona.id);
    }
  }, [isBuilding, isDraft, selectPersona, setIsCreatingPersona]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this agent? This cannot be undone.')) return;
    try {
      await deletePersona(id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      console.error('Failed to delete persona:', err);
    }
  }, [deletePersona]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Delete ${count} agent${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    for (const id of ids) {
      try {
        await deletePersona(id);
      } catch (err) {
        console.error(`Failed to delete persona ${id}:`, err);
      }
    }
  }, [selectedIds, deletePersona]);

  const handleEdit = useCallback((id: string) => {
    selectPersona(id);
  }, [selectPersona]);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredData = useMemo(() => {
    let data = [...personas];
    if (statusFilter === 'enabled') data = data.filter((p) => p.enabled && !isDraft(p));
    else if (statusFilter === 'disabled') data = data.filter((p) => !p.enabled);
    else if (statusFilter === 'building') data = data.filter((p) => isBuilding(p.id) || isDraft(p));

    if (sortKey) {
      data.sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case 'name': cmp = a.name.localeCompare(b.name); break;
          case 'status': cmp = (a.enabled ? 1 : 0) - (b.enabled ? 1 : 0); break;
          case 'triggers': cmp = (triggerCounts[a.id] ?? 0) - (triggerCounts[b.id] ?? 0); break;
          case 'lastRun': {
            const ta = lastRunMap[a.id] ?? '';
            const tb = lastRunMap[b.id] ?? '';
            cmp = ta.localeCompare(tb);
            break;
          }
        }
        return sortDir === 'desc' ? -cmp : cmp;
      });
    }
    return data;
  }, [personas, statusFilter, sortKey, sortDir, isBuilding, isDraft, triggerCounts, lastRunMap]);

  // Clear selection when data changes (e.g. filter changes)
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(filteredData.map((p) => p.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredData]);

  const allSelected = filteredData.length > 0 && filteredData.every((p) => selectedIds.has(p.id));

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredData.map((p) => p.id)));
    }
  }, [allSelected, filteredData]);

  const statusOptions = [
    { value: 'all', label: 'All' },
    { value: 'enabled', label: 'Active' },
    { value: 'disabled', label: 'Disabled' },
    { value: 'building', label: 'Drafts' },
  ];

  const columns: DataGridColumn<Persona>[] = [
    {
      key: 'select',
      label: '',
      width: '40px',
      render: (persona) => (
        <div
          onClick={(e) => { e.stopPropagation(); handleToggleSelect(persona.id); }}
          className="flex items-center justify-center"
        >
          <div className={`w-4 h-4 rounded border transition-all flex items-center justify-center cursor-pointer ${
            selectedIds.has(persona.id)
              ? 'bg-primary/80 border-primary/60'
              : 'border-primary/25 hover:border-primary/50'
          }`}>
            {selectedIds.has(persona.id) && (
              <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'favorite',
      label: '',
      width: '36px',
      render: (persona) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleFavorite(persona.id); }}
          className="flex items-center justify-center p-0.5 rounded transition-colors hover:bg-amber-500/10"
          title={isFavorite(persona.id) ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star
            className={`w-3.5 h-3.5 transition-colors ${
              isFavorite(persona.id)
                ? 'text-amber-400 fill-amber-400'
                : 'text-muted-foreground/25 hover:text-amber-400/50'
            }`}
          />
        </button>
      ),
    },
    {
      key: 'name',
      label: 'Agent',
      width: '2fr',
      sortable: true,
      render: (persona) => {
        return (
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0"
              style={persona.color ? { borderColor: `${persona.color}30`, backgroundColor: `${persona.color}15` } : undefined}
            >
              <Bot className="w-4 h-4 text-primary/70" style={persona.color ? { color: persona.color } : undefined} />
            </div>
            <div className="min-w-0">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleRowClick(persona); }}
                className="text-sm font-medium text-foreground/90 truncate block max-w-full text-left hover:text-primary transition-colors"
              >
                {persona.name}
              </button>
              {persona.description && (
                <div className="text-[11px] text-muted-foreground/50 truncate max-w-[300px]">{persona.description}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'connectors',
      label: 'Connectors',
      width: '140px',
      render: (persona) => {
        const connectors = extractConnectorNames(persona);
        if (connectors.length === 0) {
          return <span className="text-muted-foreground/20"><Plug className="w-3.5 h-3.5" /></span>;
        }
        return (
          <div className="flex items-center gap-1">
            {connectors.slice(0, 4).map((name) => {
              const meta = getConnectorMeta(name);
              return (
                <div key={name} className="w-6 h-6 rounded-md bg-secondary/30 border border-primary/10 flex items-center justify-center" title={meta.label}>
                  <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                </div>
              );
            })}
            {connectors.length > 4 && (
              <span className="text-[10px] text-muted-foreground/40 ml-0.5">+{connectors.length - 4}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: '120px',
      sortable: true,
      filterOptions: statusOptions,
      filterValue: statusFilter,
      onFilterChange: setStatusFilter,
      render: (persona) => {
        if (isBuilding(persona.id)) return <BuildingBadge />;
        return <StatusBadge enabled={persona.enabled} health={healthMap[persona.id]} isDraft={isDraft(persona)} />;
      },
    },
    {
      key: 'triggers',
      label: 'Triggers',
      width: '80px',
      sortable: true,
      align: 'right',
      render: (persona) => {
        const count = triggerCounts[persona.id] ?? 0;
        return (
          <span className="flex items-center justify-end gap-1 text-sm text-muted-foreground/60">
            <Zap className="w-3 h-3" />
            {count}
          </span>
        );
      },
    },
    {
      key: 'lastRun',
      label: 'Last Run',
      width: '120px',
      sortable: true,
      align: 'right',
      render: (persona) => {
        const lastRun = lastRunMap[persona.id];
        if (!lastRun) return <span className="text-sm text-muted-foreground/30">Never</span>;
        return (
          <span className="flex items-center justify-end gap-1 text-sm text-muted-foreground/60">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(lastRun)}
          </span>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      width: '40px',
      render: (persona) => (
        <RowActionMenu persona={persona} onDelete={handleDelete} onEdit={handleEdit} />
      ),
    },
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bot className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="All Agents"
        subtitle={`${personas.length} agent${personas.length !== 1 ? 's' : ''}`}
      >
        <BatchActionBar
          count={selectedIds.size}
          onDelete={handleBatchDelete}
          onClear={() => setSelectedIds(new Set())}
        />
      </ContentHeader>
      <ContentBody>
        <DataGrid
          columns={columns}
          data={filteredData}
          getRowKey={(p) => p.id}
          getRowAccent={(p) =>
            selectedIds.has(p.id) ? 'border-l-primary/50 bg-primary/[0.03]' :
            isBuilding(p.id) ? 'hover:border-l-violet-400' :
            isDraft(p) ? 'hover:border-l-zinc-400' :
            healthMap[p.id]?.status === 'failing' ? 'hover:border-l-red-400' :
            healthMap[p.id]?.status === 'degraded' ? 'hover:border-l-amber-400' :
            'hover:border-l-emerald-400'
          }
          sortKey={sortKey}
          sortDirection={sortDir}
          onSort={handleSort}
          pageSize={25}
          selectAll={allSelected}
          onSelectAll={handleSelectAll}
        />
      </ContentBody>
    </ContentBox>
  );
}
