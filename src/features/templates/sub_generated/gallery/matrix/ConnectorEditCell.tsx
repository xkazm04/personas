/**
 * ConnectorEditCell -- connector credential selection cell for PersonaMatrix edit mode.
 *
 * Shows ALL required connectors: builtins auto-selected, credentialed connectors
 * with link/swap UI, and missing connectors with "not connected" label so users
 * can see which architecture component types are needed.
 */
import { useMemo, useState, useRef, useCallback } from 'react';
import { CheckCircle2, X, Database, Plus, Table2, MessageSquare, AlertCircle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { CredentialMetadata } from '@/lib/types/types';
import type { RequiredConnector } from '@/lib/types/designTypes';
import type { MatrixEditState, MatrixEditCallbacks } from './matrixEditTypes';
import { getRoleForConnector } from '@/lib/credentials/connectorRoles';

const BUILTIN = new Set(['personas_messages', 'personas_database', 'personas_vector_db']);

// -- Connector Popup ---------------------------------------------------

function ConnectorPopup({
  rc,
  activeName,
  credId,
  availableCreds,
  roleMembers,
  credServiceTypes,
  callbacks,
  onClose,
  onNavigateCatalog,
}: {
  rc: RequiredConnector;
  activeName: string;
  credId: string | undefined;
  availableCreds: CredentialMetadata[];
  roleMembers: string[] | undefined;
  credServiceTypes: Set<string>;
  callbacks: MatrixEditCallbacks;
  onClose: () => void;
  onNavigateCatalog?: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  useClickOutside(popupRef, true, onClose);
  const meta = getConnectorMeta(activeName);

  // Filter role members to only those with vault credentials (same as ConnectorDropdown)
  const filteredMembers = useMemo(() => {
    if (!roleMembers) return undefined;
    const filtered = roleMembers.filter(
      (m) => m === activeName || credServiceTypes.has(m) || BUILTIN.has(m),
    );
    return filtered.length > 1 ? filtered : undefined;
  }, [roleMembers, activeName, credServiceTypes]);

  return (
    <div
      ref={popupRef}
      className="absolute left-0 right-0 top-full mt-1 z-[60] rounded-xl border border-primary/15 bg-background shadow-elevation-3 p-3.5 space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ backgroundColor: `${meta.color}20` }}
          >
            <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-medium text-foreground/80">{meta.label}</span>
        </div>
        <Button variant="ghost" size="icon-sm" icon={<X className="w-4 h-4" />} onClick={onClose} className="text-muted-foreground/60" />
      </div>

      {availableCreds.length > 0 && (
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground/70">Credential</label>
          <ThemedSelect
            filterable
            value={credId || ''}
            onValueChange={(val) => { callbacks.onCredentialSelect(activeName, val); onClose(); }}
            options={availableCreds.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select credential..."
            className="!py-1.5 !px-2.5 !text-sm !rounded-lg"
          />
        </div>
      )}

      {filteredMembers && (
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground/70">Connector Type</label>
          <ThemedSelect
            filterable
            value={activeName}
            onValueChange={(val) => { callbacks.onConnectorSwap(rc.name, val); onClose(); }}
            options={filteredMembers.map((m) => ({ value: m, label: getConnectorMeta(m).label }))}
            placeholder="Switch connector..."
            className="!py-1.5 !px-2.5 !text-sm !rounded-lg"
          />
        </div>
      )}

      {availableCreds.length === 0 && (
        <p className="text-sm text-muted-foreground/40 italic">No credentials available for this connector</p>
      )}

      {availableCreds.length === 0 && onNavigateCatalog && (
        <Button variant="link" size="xs" onClick={() => { onNavigateCatalog(); onClose(); }} className="text-[11px] text-primary/70 hover:text-primary p-0">
          Add in Keys Catalog
        </Button>
      )}
    </div>
  );
}

// -- Database Row -----------------------------------------------------

function DatabaseRow({
  dbMode,
  callbacks,
  editState,
}: {
  dbMode: 'create' | 'existing';
  callbacks: MatrixEditCallbacks;
  editState: MatrixEditState;
}) {
  const [showTablePicker, setShowTablePicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useClickOutside(pickerRef, showTablePicker, () => setShowTablePicker(false));

  const tableName = editState.databaseTable;
  const schemaName = editState.databaseSchema;

  const handleSetTable = useCallback((value: string) => {
    callbacks.onPreferenceChange('databaseTable', value);
  }, [callbacks]);

  const handleSetSchema = useCallback((value: string) => {
    callbacks.onPreferenceChange('databaseSchema', value);
  }, [callbacks]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 py-1">
        <Database className="w-4 h-4 text-primary/60 flex-shrink-0" />
        <span className="text-sm font-medium text-foreground/80 truncate flex-1">Database</span>
        <div className="flex items-center gap-0.5 rounded-md border border-primary/10 overflow-hidden">
          <Button variant="ghost" size="xs" onClick={() => { callbacks.onPreferenceChange('databaseMode', 'create'); }}
            className={`px-2 py-0.5 text-sm font-medium ${dbMode === 'create' ? 'bg-primary/15 text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground/60'}`}>
            <Plus className="w-3 h-3 inline -mt-px mr-0.5" /> New
          </Button>
          <Button variant="ghost" size="xs" onClick={() => { callbacks.onPreferenceChange('databaseMode', 'existing'); }}
            className={`px-2 py-0.5 text-sm font-medium ${dbMode === 'existing' ? 'bg-primary/15 text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground/60'}`}>
            <Table2 className="w-3 h-3 inline -mt-px mr-0.5" /> Existing
          </Button>
        </div>
      </div>
      {dbMode === 'existing' && (
        <div className="relative ml-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTablePicker(!showTablePicker)}
            className="w-full flex items-center gap-2 py-1 rounded-lg hover:bg-primary/5 text-left"
          >
            <Table2 className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" />
            <span className="text-sm text-foreground/70 truncate flex-1">
              {tableName || 'Configure table...'}
            </span>
            {tableName && <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
          </Button>

          {showTablePicker && (
            <div
              ref={pickerRef}
              className="absolute left-0 right-0 top-full mt-1 z-[60] rounded-xl border border-primary/15 bg-background shadow-elevation-3 p-3.5 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground/80">Existing Table</span>
                <Button variant="ghost" size="icon-sm" icon={<X className="w-4 h-4" />} onClick={() => setShowTablePicker(false)} className="text-muted-foreground/60" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground/70">Schema</label>
                <input
                  type="text"
                  value={schemaName || ''}
                  onChange={(e) => handleSetSchema(e.target.value)}
                  placeholder="public"
                  className="w-full rounded-lg border border-primary/15 bg-background px-2.5 py-1.5 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus-ring"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground/70">Table name</label>
                <input
                  type="text"
                  value={tableName || ''}
                  onChange={(e) => handleSetTable(e.target.value)}
                  placeholder="e.g. persona_data"
                  className="w-full rounded-lg border border-primary/15 bg-background px-2.5 py-1.5 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus-ring"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -- Connector cell (edit mode) ----------------------------------------

interface ConnectorEditCellProps {
  requiredConnectors: RequiredConnector[];
  credentials: CredentialMetadata[];
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
  onNavigateCatalog?: () => void;
}

export function ConnectorEditCell({
  requiredConnectors,
  credentials,
  editState,
  callbacks,
  onNavigateCatalog,
}: ConnectorEditCellProps) {
  const [popupConnector, setPopupConnector] = useState<string | null>(null);

  // Build set of service_types present in vault (same as wizard's useAdoptionAutoResolve)
  const credServiceTypes = useMemo(
    () => new Set(credentials.map((c) => c.service_type)),
    [credentials],
  );

  // Show ALL required connectors -- matched, builtin, and missing
  const allConnectors = requiredConnectors;

  if (allConnectors.length === 0) {
    return (
      <div className="space-y-2 w-full">
        <span className="text-sm text-muted-foreground/40">No connectors required</span>
      </div>
    );
  }

  const dbMode = editState.databaseMode ?? 'create';

  return (
    <div className="space-y-1 w-full">
      {allConnectors.slice(0, 5).map((rc) => {
        const activeName = editState.connectorSwaps[rc.name] || rc.activeName;
        const meta = getConnectorMeta(activeName);
        const credId = editState.connectorCredentialMap[activeName];
        const matchedCred = credentials.find((c) => c.id === credId);
        const availableCreds = credentials.filter((c) => c.service_type === activeName);
        const isBuiltin = BUILTIN.has(activeName);
        const isMatched = isBuiltin || !!credId;
        const hasCred = credServiceTypes.has(activeName);
        const isOpen = popupConnector === rc.name;

        // Compact DB setup row for personas_database
        if (activeName === 'personas_database') {
          return (
            <DatabaseRow key={rc.name} dbMode={dbMode} callbacks={callbacks} editState={editState} />
          );
        }

        // Compact auto-selected row for personas_messages
        if (activeName === 'personas_messages') {
          return (
            <div key={rc.name} className="flex items-center gap-2 py-1">
              <MessageSquare className="w-4 h-4 text-primary/60 flex-shrink-0" />
              <span className="text-sm font-medium text-foreground/80 truncate flex-1">In-App Messages</span>
              <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
            </div>
          );
        }

        // Missing connector -- no credential and not builtin
        if (!isBuiltin && !hasCred) {
          const role = getRoleForConnector(activeName);
          const roleLabel = role ? role.label : rc.roleLabel;
          return (
            <div key={rc.name} className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPopupConnector(isOpen ? null : rc.name)}
                className="w-full flex items-center gap-2 py-1 rounded-lg hover:bg-primary/5 cursor-pointer group"
              >
                <div
                  className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${meta.color}20` }}
                >
                  <ConnectorIcon meta={meta} size="w-3 h-3" />
                </div>
                <span className="text-sm font-medium text-orange-600 dark:text-amber-400 truncate flex-1 text-left">
                  {roleLabel || meta.label}
                </span>
                <AlertCircle className="w-3 h-3 text-orange-500 dark:text-amber-400/60 flex-shrink-0" />
                <span className="text-[11px] text-orange-600/80 dark:text-amber-400/70 whitespace-nowrap">not connected</span>
              </Button>

              {isOpen && (
                <ConnectorPopup
                  rc={rc}
                  activeName={activeName}
                  credId={credId}
                  availableCreds={availableCreds}
                  roleMembers={rc.roleMembers}
                  credServiceTypes={credServiceTypes}
                  callbacks={callbacks}
                  onClose={() => setPopupConnector(null)}
                  onNavigateCatalog={onNavigateCatalog}
                />
              )}
            </div>
          );
        }

        return (
          <div key={rc.name} className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPopupConnector(isOpen ? null : rc.name)}
              className="w-full flex items-center gap-2 py-1 rounded-lg hover:bg-primary/5 cursor-pointer group"
            >
              <div
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${meta.color}20` }}
              >
                <ConnectorIcon meta={meta} size="w-3 h-3" />
              </div>
              <span className="text-sm font-medium text-foreground/80 truncate flex-1 text-left">{meta.label}</span>
              {isMatched ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 dark:bg-amber-400/60 flex-shrink-0" />
              )}
              <span className={`text-sm truncate max-w-[80px] ${isMatched ? 'text-muted-foreground/40' : 'text-orange-600 dark:text-amber-400/80 font-semibold'}`}>
                {matchedCred?.name ?? (isMatched ? 'Linked' : 'Set up')}
              </span>
            </Button>

            {isOpen && (
              <ConnectorPopup
                rc={rc}
                activeName={activeName}
                credId={credId}
                availableCreds={availableCreds}
                roleMembers={rc.roleMembers}
                credServiceTypes={credServiceTypes}
                callbacks={callbacks}
                onClose={() => setPopupConnector(null)}
                onNavigateCatalog={onNavigateCatalog}
              />
            )}
          </div>
        );
      })}
      {allConnectors.length > 5 && (
        <span className="text-sm text-muted-foreground/40">+{allConnectors.length - 5} more</span>
      )}
    </div>
  );
}
