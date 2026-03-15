import { useState, useMemo, useCallback } from 'react';
import { Bot, Zap, Clock, Loader2 } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { extractConnectorNames } from '@/lib/personas/utils';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';

// -- Status helpers --

const HEALTH_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  healthy:  { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Healthy' },
  degraded: { bg: 'bg-amber-500/10',   text: 'text-amber-400',   label: 'Degraded' },
  failing:  { bg: 'bg-red-500/10',     text: 'text-red-400',     label: 'Failing' },
};

function StatusBadge({ enabled, health }: { enabled: boolean; health?: PersonaHealth }) {
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

// -- Main component --

export default function PersonaOverviewPage() {
  const personas = useAgentStore((s) => s.personas);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const triggerCounts = useAgentStore((s) => s.personaTriggerCounts);
  const lastRunMap = useAgentStore((s) => s.personaLastRun);
  const healthMap = useAgentStore((s) => s.personaHealthMap);
  const buildPersonaId = useAgentStore((s) => s.buildPersonaId);
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const setIsCreatingPersona = useSystemStore((s) => s.setIsCreatingPersona);

  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<string | null>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Check if a persona has an active build session
  const isBuilding = useCallback((id: string) => {
    return id === buildPersonaId && buildPhase !== 'initializing' && buildPhase !== 'promoted';
  }, [buildPersonaId, buildPhase]);

  const handleRowClick = useCallback((persona: Persona) => {
    if (isBuilding(persona.id)) {
      // In-progress persona: open its PersonaMatrix
      useAgentStore.setState({ buildPersonaId: persona.id });
      setIsCreatingPersona(true);
    } else {
      // Completed persona: open PersonaEditor
      selectPersona(persona.id);
    }
  }, [isBuilding, selectPersona, setIsCreatingPersona]);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  // Filter + sort
  const filteredData = useMemo(() => {
    let data = [...personas];

    // Filter
    if (statusFilter === 'enabled') data = data.filter((p) => p.enabled);
    else if (statusFilter === 'disabled') data = data.filter((p) => !p.enabled);
    else if (statusFilter === 'building') data = data.filter((p) => isBuilding(p.id));

    // Sort
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
  }, [personas, statusFilter, sortKey, sortDir, isBuilding, triggerCounts, lastRunMap]);

  const statusOptions = [
    { value: 'all', label: 'All' },
    { value: 'enabled', label: 'Active' },
    { value: 'disabled', label: 'Disabled' },
    { value: 'building', label: 'Building' },
  ];

  const columns: DataGridColumn<Persona>[] = [
    {
      key: 'name',
      label: 'Agent',
      width: '2fr',
      sortable: true,
      render: (persona) => {
        const connectors = extractConnectorNames(persona);
        return (
          <div className="flex items-center gap-3 min-w-0">
            {/* Icon */}
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0"
              style={persona.color ? { borderColor: `${persona.color}30`, backgroundColor: `${persona.color}15` } : undefined}
            >
              <Bot className="w-4 h-4 text-primary/70" style={persona.color ? { color: persona.color } : undefined} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground/90 truncate">{persona.name}</div>
              {persona.description && (
                <div className="text-[11px] text-muted-foreground/50 truncate max-w-[300px]">{persona.description}</div>
              )}
            </div>
            {/* Connector pills */}
            {connectors.length > 0 && (
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                {connectors.slice(0, 3).map((name) => {
                  const meta = getConnectorMeta(name);
                  return (
                    <div key={name} className="w-5 h-5 rounded bg-secondary/30 flex items-center justify-center" title={meta.label}>
                      <ConnectorIcon meta={meta} size="w-3 h-3" />
                    </div>
                  );
                })}
                {connectors.length > 3 && (
                  <span className="text-[10px] text-muted-foreground/40">+{connectors.length - 3}</span>
                )}
              </div>
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
        return <StatusBadge enabled={persona.enabled} health={healthMap[persona.id]} />;
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
      key: 'model',
      label: 'Model',
      width: '100px',
      render: (persona) => (
        <span className="text-[11px] text-muted-foreground/50 font-mono truncate">
          {persona.model_profile ?? 'default'}
        </span>
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
      />
      <ContentBody>
        <DataGrid
          columns={columns}
          data={filteredData}
          getRowKey={(p) => p.id}
          onRowClick={handleRowClick}
          getRowAccent={(p) =>
            isBuilding(p.id) ? 'hover:border-l-violet-400' :
            healthMap[p.id]?.status === 'failing' ? 'hover:border-l-red-400' :
            healthMap[p.id]?.status === 'degraded' ? 'hover:border-l-amber-400' :
            'hover:border-l-emerald-400'
          }
          sortKey={sortKey}
          sortDirection={sortDir}
          onSort={handleSort}
          pageSize={25}
        />
      </ContentBody>
    </ContentBox>
  );
}
