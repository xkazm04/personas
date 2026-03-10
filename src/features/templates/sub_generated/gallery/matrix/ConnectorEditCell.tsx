/**
 * ConnectorEditCell — connector credential selection cell for PersonaMatrix edit mode.
 */
import { useMemo, useState, useRef } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { CredentialMetadata } from '@/lib/types/types';
import type { RequiredConnector } from '../../adoption/steps/connect/ConnectStep';
import type { MatrixEditState, MatrixEditCallbacks } from './matrixEditTypes';

// ── Connector Popup ───────────────────────────────────────────────────

function ConnectorPopup({
  rc,
  activeName,
  credId,
  availableCreds,
  roleMembers,
  callbacks,
  onClose,
}: {
  rc: RequiredConnector;
  activeName: string;
  credId: string | undefined;
  availableCreds: CredentialMetadata[];
  roleMembers: string[] | undefined;
  callbacks: MatrixEditCallbacks;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  useClickOutside(popupRef, true, onClose);
  const meta = getConnectorMeta(activeName);

  return (
    <div
      ref={popupRef}
      className="absolute left-0 right-0 top-full mt-1 z-[60] rounded-xl border border-primary/15 bg-background shadow-lg p-3.5 space-y-3"
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
        <button type="button" onClick={onClose} className="p-0.5 rounded hover:bg-primary/10 transition-colors">
          <X className="w-3.5 h-3.5 text-muted-foreground/60" />
        </button>
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

      {roleMembers && roleMembers.length > 1 && (
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground/70">Connector Type</label>
          <ThemedSelect
            filterable
            value={activeName}
            onValueChange={(val) => { callbacks.onConnectorSwap(rc.name, val); onClose(); }}
            options={roleMembers.map((m) => ({ value: m, label: getConnectorMeta(m).label }))}
            placeholder="Switch connector..."
            className="!py-1.5 !px-2.5 !text-sm !rounded-lg"
          />
        </div>
      )}

      {availableCreds.length === 0 && (
        <p className="text-sm text-muted-foreground/40 italic">No credentials available for this connector</p>
      )}
    </div>
  );
}

// ── Connector cell (edit mode) ────────────────────────────────────────

interface ConnectorEditCellProps {
  requiredConnectors: RequiredConnector[];
  credentials: CredentialMetadata[];
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
  missingConnectorTypes?: string[];
  onNavigateCatalog?: () => void;
}

export function ConnectorEditCell({
  requiredConnectors,
  credentials,
  editState,
  callbacks,
  missingConnectorTypes,
  onNavigateCatalog,
}: ConnectorEditCellProps) {
  const [popupConnector, setPopupConnector] = useState<string | null>(null);
  const missingSet = useMemo(() => new Set(missingConnectorTypes ?? []), [missingConnectorTypes]);

  // Only show connectors that have credentials in the vault
  const availableConnectors = useMemo(
    () => requiredConnectors.filter((rc) => {
      const name = editState.connectorSwaps[rc.name] || rc.activeName;
      return !missingSet.has(name);
    }),
    [requiredConnectors, editState.connectorSwaps, missingSet],
  );

  if (availableConnectors.length === 0) {
    return (
      <div className="space-y-2 w-full">
        <span className="text-sm text-muted-foreground/40">No credentials in vault</span>
        {onNavigateCatalog && (
          <button type="button" onClick={onNavigateCatalog} className="block text-[11px] text-primary/70 hover:text-primary transition-colors">
            Add in Keys Catalog
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1 w-full">
      {availableConnectors.slice(0, 4).map((rc) => {
        const activeName = editState.connectorSwaps[rc.name] || rc.activeName;
        const meta = getConnectorMeta(activeName);
        const credId = editState.connectorCredentialMap[activeName];
        const matchedCred = credentials.find((c) => c.id === credId);
        const availableCreds = credentials.filter((c) => c.service_type === activeName);
        const isMatched = !!credId;
        const isOpen = popupConnector === rc.name;

        return (
          <div key={rc.name} className="relative">
            <button
              type="button"
              onClick={() => setPopupConnector(isOpen ? null : rc.name)}
              className="w-full flex items-center gap-2 py-1 rounded-lg hover:bg-primary/5 transition-colors cursor-pointer group"
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
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 flex-shrink-0" />
              )}
              <span className="text-sm text-muted-foreground/40 truncate max-w-[80px]">
                {matchedCred?.name ?? (isMatched ? 'Linked' : 'Set up')}
              </span>
            </button>

            {isOpen && (
              <ConnectorPopup
                rc={rc}
                activeName={activeName}
                credId={credId}
                availableCreds={availableCreds}
                roleMembers={rc.roleMembers}
                callbacks={callbacks}
                onClose={() => setPopupConnector(null)}
              />
            )}
          </div>
        );
      })}
      {availableConnectors.length > 4 && (
        <span className="text-sm text-muted-foreground/40">+{availableConnectors.length - 4} more</span>
      )}
    </div>
  );
}
