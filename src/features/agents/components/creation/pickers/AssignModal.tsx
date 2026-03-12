import { useState, useMemo } from 'react';
import { X, Search, Key } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/features/shared/components/buttons';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { ComponentRole } from '../steps/builder/types';
import { COMPONENT_ROLES } from '../steps/builder/types';
import { roleIcons, roleColors, roleIconColors } from './selectors/componentPickerConstants';

// -- Assign Modal -------------------------------------------------------------

export function AssignModal({
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
        className="bg-background border border-primary/20 rounded-2xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg bg-gradient-to-br ${roleColors[role]}`}>
              <Icon className={`w-4 h-4 ${roleIconColors[role]}`} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">
                Assign to {roleDef?.label}
              </h3>
              <p className="text-sm text-muted-foreground/65">{roleDef?.description}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" icon={<X className="w-4 h-4" />} onClick={onClose} />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-primary/10 px-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTab('credentials')}
            className={`px-3 py-2 border-b-2 ${
              tab === 'credentials'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground/70 hover:text-muted-foreground'
            }`}
          >
            Saved Credentials ({credentials.length})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTab('connectors')}
            className={`px-3 py-2 border-b-2 ${
              tab === 'connectors'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground/70 hover:text-muted-foreground'
            }`}
          >
            All Connectors ({connectorDefinitions.length})
          </Button>
        </div>

        {/* Search */}
        <div className="relative px-4 pt-3 pb-2">
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
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {tab === 'credentials' ? (
            filteredCredentials.length === 0 ? (
              <div className="text-center py-8">
                <Key className="w-5 h-5 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground/65">
                  {credentials.length === 0
                    ? 'No saved credentials yet'
                    : 'No credentials match your search'}
                </p>
                <p className="text-sm text-muted-foreground/50 mt-1">
                  Save credentials in the Vault, or use the Connectors tab
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredCredentials.map((cred) => {
                  const meta = getConnectorMeta(cred.service_type);
                  return (
                    <Button
                      key={cred.id}
                      variant="ghost"
                      size="sm"
                      onClick={() => { onAssign(cred.service_type, cred.id); onClose(); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:bg-secondary/40 hover:border-primary/10 text-left"
                    >
                      <ConnectorIcon meta={meta} size="w-5 h-5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground/80 truncate">{cred.name}</p>
                        <p className="text-sm text-muted-foreground/60">{cred.service_type}</p>
                      </div>
                      <Key className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                    </Button>
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
                    <p className="text-sm font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5">
                      {category}
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {connectors.map((c) => {
                        const meta = getConnectorMeta(c.name);
                        return (
                          <Button
                            key={c.name}
                            variant="ghost"
                            size="sm"
                            onClick={() => { onAssign(c.name, null); onClose(); }}
                            className="flex items-center gap-2 px-2.5 py-2 rounded-xl border border-transparent hover:bg-secondary/40 hover:border-primary/10 text-muted-foreground/80 hover:text-foreground/90"
                          >
                            <ConnectorIcon meta={meta} size="w-4 h-4" />
                            <span className="truncate">{meta.label}</span>
                          </Button>
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
