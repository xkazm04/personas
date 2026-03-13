import { useState, useMemo, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useVaultStore } from "@/stores/vaultStore";
import type { BuilderComponent, ComponentRole } from '../../steps/builder/types';
import { COMPONENT_ROLES } from '../../steps/builder/types';
import { BUILTIN_CONNECTORS } from './componentPickerConstants';
import { AssignModal } from '../AssignModal';
import { TableSelectorModal } from './TableSelectorModal';
import { CredentialCoverageBar } from '../CredentialCoverageBar';
import { RoleCard, isDatabaseConnector } from '../RoleCard';

// -- Props --------------------------------------------------------------------

interface ComponentsPickerProps {
  components: BuilderComponent[];
  onAdd: (payload: { role: ComponentRole; connectorName: string; credentialId: string | null }) => void;
  onRemove: (id: string) => void;
  onSetWatchedTables?: (componentId: string, tables: string[]) => void;
}

// -- Main Component -----------------------------------------------------------

export function ComponentsPicker({ components, onAdd, onRemove, onSetWatchedTables }: ComponentsPickerProps) {
  const [assignRole, setAssignRole] = useState<ComponentRole | null>(null);
  const [tableSelectorCompId, setTableSelectorCompId] = useState<string | null>(null);
  const credentials = useVaultStore((s) => s.credentials);
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
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
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
