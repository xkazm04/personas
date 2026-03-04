import { useState, useMemo, useEffect, useRef } from 'react';
import { Download, Database, Zap, Bell, Plus, X, Search, Key, Table2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { getConnectorFamily } from '@/features/vault/sub_databases/introspectionQueries';
import { useTableIntrospection } from '@/hooks/database/useTableIntrospection';
import { TableSelector } from '@/features/shared/components/TableSelector';
import type { BuilderComponent, ComponentRole } from './types';
import { COMPONENT_ROLES } from './types';
import { computeCredentialCoverage, computeRoleCoverage } from './builderReducer';

// ── Props ───────────────────────────────────────────────────────────

interface ComponentsPickerProps {
  components: BuilderComponent[];
  onAdd: (payload: { role: ComponentRole; connectorName: string; credentialId: string | null }) => void;
  onRemove: (id: string) => void;
  onSetWatchedTables?: (componentId: string, tables: string[]) => void;
}

// ── Role icons ──────────────────────────────────────────────────────

const roleIcons: Record<ComponentRole, typeof Download> = {
  retrieve: Download,
  store: Database,
  act: Zap,
  notify: Bell,
};

const roleColors: Record<ComponentRole, string> = {
  retrieve: 'from-blue-500/15 to-cyan-500/10 border-blue-500/20',
  store: 'from-amber-500/15 to-orange-500/10 border-amber-500/20',
  act: 'from-violet-500/15 to-purple-500/10 border-violet-500/20',
  notify: 'from-emerald-500/15 to-green-500/10 border-emerald-500/20',
};

const roleIconColors: Record<ComponentRole, string> = {
  retrieve: 'text-blue-400',
  store: 'text-amber-400',
  act: 'text-violet-400',
  notify: 'text-emerald-400',
};

// ── Database detection ──────────────────────────────────────────────

function isDatabaseConnector(connectorName: string): boolean {
  const family = getConnectorFamily(connectorName);
  return family !== 'unsupported' && family !== 'redis';
}

// ── Assign Modal ────────────────────────────────────────────────────

function AssignModal({
  role,
  existingIds,
  onAssign,
  onClose,
}: {
  role: ComponentRole;
  existingIds: Set<string>;
  onAssign: (connectorName: string, credentialId: string | null) => void;
  onClose: () => void;
}) {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'credentials' | 'connectors'>('credentials');

  const roleDef = COMPONENT_ROLES.find((r) => r.role === role);
  const Icon = roleIcons[role];

  const filteredCredentials = useMemo(() => {
    const q = search.toLowerCase().trim();
    return credentials.filter((c) => {
      if (existingIds.has(c.id)) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.service_type.toLowerCase().includes(q);
    });
  }, [credentials, existingIds, search]);

  const filteredConnectors = useMemo(() => {
    const q = search.toLowerCase().trim();
    return connectorDefinitions.filter((c) => {
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q);
    });
  }, [connectorDefinitions, search]);

  const groupedConnectors = useMemo(() => {
    const groups: Record<string, typeof filteredConnectors> = {};
    for (const c of filteredConnectors) {
      const cat = c.category || 'other';
      (groups[cat] ??= []).push(c);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredConnectors]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15 }}
        className="bg-background border border-primary/15 rounded-2xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg bg-gradient-to-br ${roleColors[role]}`}>
              <Icon className={`w-4 h-4 ${roleIconColors[role]}`} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">
                Assign to {roleDef?.label}
              </h3>
              <p className="text-[11px] text-muted-foreground/65">{roleDef?.description}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-muted-foreground/60 hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-primary/8 px-5">
          <button
            type="button"
            onClick={() => setTab('credentials')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === 'credentials'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground/70 hover:text-muted-foreground'
            }`}
          >
            Saved Credentials ({credentials.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('connectors')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === 'connectors'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground/70 hover:text-muted-foreground'
            }`}
          >
            All Connectors ({connectorDefinitions.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative px-5 pt-3 pb-2">
          <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/55 mt-[2px]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'credentials' ? 'Search credentials...' : 'Search connectors...'}
            autoFocus
            className="w-full pl-7 pr-3 py-2 bg-secondary/40 border border-primary/10 rounded-xl text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {tab === 'credentials' ? (
            filteredCredentials.length === 0 ? (
              <div className="text-center py-8">
                <Key className="w-5 h-5 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground/65">
                  {credentials.length === 0
                    ? 'No saved credentials yet'
                    : 'No credentials match your search'}
                </p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  Save credentials in the Vault, or use the Connectors tab
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredCredentials.map((cred) => {
                  const meta = getConnectorMeta(cred.service_type);
                  return (
                    <button
                      key={cred.id}
                      type="button"
                      onClick={() => { onAssign(cred.service_type, cred.id); onClose(); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:bg-secondary/40 hover:border-primary/10 transition-all text-left"
                    >
                      <ConnectorIcon meta={meta} size="w-5 h-5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground/80 truncate">{cred.name}</p>
                        <p className="text-[11px] text-muted-foreground/60">{cred.service_type}</p>
                      </div>
                      <Key className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            groupedConnectors.length === 0 ? (
              <p className="text-sm text-muted-foreground/60 text-center py-8">
                No connectors match your search
              </p>
            ) : (
              <div className="space-y-3 pt-1">
                {groupedConnectors.map(([category, connectors]) => (
                  <div key={category}>
                    <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5">
                      {category}
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {connectors.map((c) => {
                        const meta = getConnectorMeta(c.name);
                        return (
                          <button
                            key={c.name}
                            type="button"
                            onClick={() => { onAssign(c.name, null); onClose(); }}
                            className="flex items-center gap-2 px-2.5 py-2 text-xs rounded-lg border border-transparent hover:bg-secondary/40 hover:border-primary/10 text-muted-foreground/80 hover:text-foreground/90 transition-all"
                          >
                            <ConnectorIcon meta={meta} size="w-4 h-4" />
                            <span className="truncate">{meta.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Table Selector Modal ────────────────────────────────────────────

function TableSelectorModal({
  component,
  onSetWatchedTables,
  onClose,
}: {
  component: BuilderComponent;
  onSetWatchedTables: (componentId: string, tables: string[]) => void;
  onClose: () => void;
}) {
  const { tables, loading, error, fetchTables } = useTableIntrospection({
    credentialId: component.credentialId!,
    serviceType: component.connectorName,
    autoFetch: true,
  });

  const meta = getConnectorMeta(component.connectorName);
  const count = component.watchedTables?.length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15 }}
        className="bg-background border border-primary/15 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-amber-500/15 to-orange-500/10 border border-amber-500/20">
              <Table2 className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">
                Select Tables
              </h3>
              <p className="text-[11px] text-muted-foreground/65">
                {meta.label} — choose tables to watch
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-muted-foreground/60 hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Table Selector */}
        <div className="p-4">
          <TableSelector
            tables={tables}
            selectedTables={component.watchedTables ?? []}
            onSelectionChange={(t) => onSetWatchedTables(component.id, t)}
            loading={loading}
            error={error}
            onRefresh={() => fetchTables(true)}
            maxHeight="360px"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-primary/10">
          <p className="text-xs text-muted-foreground/50">
            {count > 0
              ? `${count} table${count !== 1 ? 's' : ''} selected`
              : 'No tables selected — agent watches all'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium rounded-lg text-muted-foreground/70 hover:text-foreground/80 hover:bg-secondary/40 transition-colors"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Credential Coverage Bar ─────────────────────────────────────────

function CredentialCoverageBar({ components }: { components: BuilderComponent[] }) {
  const coverage = computeCredentialCoverage(components);
  if (coverage.total === 0) return null;

  const pct = Math.round((coverage.matched / coverage.total) * 100);
  const barColor = coverage.status === 'full' ? 'bg-emerald-400' : coverage.status === 'partial' ? 'bg-amber-400' : 'bg-zinc-500';
  const textColor = coverage.status === 'full' ? 'text-emerald-400' : coverage.status === 'partial' ? 'text-amber-400' : 'text-muted-foreground/60';

  return (
    <div className="flex items-center gap-2.5 mb-2">
      <div className="flex-1 h-1 rounded-full bg-secondary/40 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] font-medium ${textColor} shrink-0`}>
        {coverage.matched}/{coverage.total} credentials
      </span>
    </div>
  );
}

// ── Role Card ───────────────────────────────────────────────────────

const BUILTIN_CONNECTORS = new Set(['in-app-messaging', 'http']);

function RoleCoverageDot({ role, components }: { role: ComponentRole; components: BuilderComponent[] }) {
  const status = computeRoleCoverage(components, role);
  if (status === 'none') return null;
  const color = status === 'full' ? 'bg-emerald-400' : 'bg-amber-400';
  return <span className={`w-1.5 h-1.5 rounded-full ${color} shrink-0`} />;
}

function RoleCard({
  role,
  label,
  description,
  components,
  onOpenAssign,
  onRemove,
  onOpenTableSelector,
}: {
  role: ComponentRole;
  label: string;
  description: string;
  components: BuilderComponent[];
  onOpenAssign: () => void;
  onRemove: (id: string) => void;
  onOpenTableSelector?: (componentId: string) => void;
}) {
  const credentials = usePersonaStore((s) => s.credentials);
  const Icon = roleIcons[role];

  return (
    <div className={`flex flex-col rounded-xl border bg-gradient-to-b ${roleColors[role]} overflow-hidden`}>
      {/* Card head */}
      <div className="flex flex-col items-center pt-4 pb-2 px-3">
        <div className="p-2.5 rounded-xl bg-background/60 backdrop-blur-sm border border-white/5 mb-2">
          <Icon className={`w-6 h-6 ${roleIconColors[role]}`} />
        </div>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground/85">{label}</p>
          <RoleCoverageDot role={role} components={components} />
        </div>
        <p className="text-xs text-muted-foreground/65 mt-0.5">{description}</p>
      </div>

      {/* Assigned items */}
      <div className="flex-1 px-2.5 pb-2 space-y-1">
        <AnimatePresence>
          {components.map((comp) => {
            const meta = getConnectorMeta(comp.connectorName);
            const credName = comp.credentialId
              ? credentials.find((c) => c.id === comp.credentialId)?.name
              : null;
            const isDb = comp.credentialId && isDatabaseConnector(comp.connectorName);
            return (
              <motion.div
                key={comp.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.12 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-background/50 border border-primary/10 rounded-md text-sm">
                  <ConnectorIcon meta={meta} size="w-4 h-4" />
                  <span className="flex-1 min-w-0 truncate text-foreground/70">
                    {credName ?? meta.label}
                  </span>
                  {credName ? (
                    <Key className="w-3 h-3 text-primary/40 shrink-0" />
                  ) : !BUILTIN_CONNECTORS.has(comp.connectorName) ? (
                    <span className="text-[10px] font-medium text-amber-400/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded shrink-0">
                      No credential
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onRemove(comp.id)}
                    className="p-0.5 text-muted-foreground/50 hover:text-red-400 transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Watched table pills + edit button */}
                {isDb && (
                  <div className="flex flex-wrap items-center gap-0.5 px-1.5 pt-1 pb-0.5">
                    {comp.watchedTables && comp.watchedTables.length > 0 ? (
                      <>
                        {comp.watchedTables.slice(0, 4).map((tableName) => (
                          <span
                            key={tableName}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/15 rounded text-[10px] font-mono text-amber-400/80"
                          >
                            <Table2 className="w-2 h-2" />
                            {tableName}
                          </span>
                        ))}
                        {comp.watchedTables.length > 4 && (
                          <span className="text-[10px] text-muted-foreground/40 self-center">
                            +{comp.watchedTables.length - 4}
                          </span>
                        )}
                      </>
                    ) : null}
                    {onOpenTableSelector && (
                      <button
                        type="button"
                        onClick={() => onOpenTableSelector(comp.id)}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/50 hover:text-amber-400/80 hover:bg-amber-500/8 rounded transition-colors"
                      >
                        <Table2 className="w-2 h-2" />
                        {comp.watchedTables?.length ? 'edit' : 'select tables'}
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Add button */}
      <div className="px-2.5 pb-2.5">
        <button
          type="button"
          onClick={onOpenAssign}
          className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground/65 border border-dashed border-primary/20 rounded-lg hover:bg-background/40 hover:text-foreground/80 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Assign
        </button>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function ComponentsPicker({ components, onAdd, onRemove, onSetWatchedTables }: ComponentsPickerProps) {
  const [assignRole, setAssignRole] = useState<ComponentRole | null>(null);
  const [tableSelectorCompId, setTableSelectorCompId] = useState<string | null>(null);
  const credentials = usePersonaStore((s) => s.credentials);
  const prevCountRef = useRef(components.length);

  const componentsByRole = useMemo(() => {
    const map: Record<ComponentRole, BuilderComponent[]> = {
      retrieve: [], store: [], act: [], notify: [],
    };
    for (const c of components) {
      map[c.role].push(c);
    }
    return map;
  }, [components]);

  // Auto-open table selector when a new database component is added
  useEffect(() => {
    if (components.length > prevCountRef.current && onSetWatchedTables) {
      const newest = components[components.length - 1];
      if (newest && newest.credentialId && isDatabaseConnector(newest.connectorName)) {
        setTableSelectorCompId(newest.id);
      }
    }
    prevCountRef.current = components.length;
  }, [components, onSetWatchedTables]);

  // Collect credential IDs already assigned under the active role to prevent duplicates
  const existingIdsForRole = useMemo(() => {
    if (!assignRole) return new Set<string>();
    return new Set(
      componentsByRole[assignRole]
        .filter((c) => c.credentialId)
        .map((c) => c.credentialId!),
    );
  }, [assignRole, componentsByRole]);

  const tableSelectorComp = tableSelectorCompId
    ? components.find((c) => c.id === tableSelectorCompId)
    : null;

  return (
    <div>
      <CredentialCoverageBar components={components} />
      <div className="grid grid-cols-4 gap-2">
        {COMPONENT_ROLES.map(({ role, label, description }) => (
          <RoleCard
            key={role}
            role={role}
            label={label}
            description={description}
            components={componentsByRole[role]}
            onOpenAssign={() => setAssignRole(role)}
            onRemove={onRemove}
            onOpenTableSelector={onSetWatchedTables ? setTableSelectorCompId : undefined}
          />
        ))}
      </div>

      <AnimatePresence>
        {assignRole && (
          <AssignModal
            role={assignRole}
            existingIds={existingIdsForRole}
            onAssign={(connectorName, credentialId) => {
              // Auto-match credential if adding connector-only
              let resolvedCredId = credentialId;
              if (!resolvedCredId && !BUILTIN_CONNECTORS.has(connectorName)) {
                const match = credentials.find((c) => c.service_type === connectorName);
                if (match) resolvedCredId = match.id;
              }
              onAdd({ role: assignRole, connectorName, credentialId: resolvedCredId });
            }}
            onClose={() => setAssignRole(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {tableSelectorComp && onSetWatchedTables && (
          <TableSelectorModal
            component={tableSelectorComp}
            onSetWatchedTables={onSetWatchedTables}
            onClose={() => setTableSelectorCompId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
