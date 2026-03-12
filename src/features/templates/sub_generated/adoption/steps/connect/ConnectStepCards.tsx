/**
 * ConnectStep sub-components: UnresolvedComponentCard.
 * DatabaseSetupCard is in DatabaseSetupCard.tsx.
 */
import { useMemo, useCallback } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Box,
  Plus,
} from 'lucide-react';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { ConnectorDropdown } from './ConnectorDropdown';
import type { CredentialMetadata } from '@/lib/types/types';
import type { RequiredConnector } from './ConnectStep';

// Re-export DatabaseSetupCard for convenience
export { DatabaseSetupCard } from './DatabaseSetupCard';

// -- Helpers ------------------------------------------------------------

const BUILTIN_CONNECTORS = new Set(['personas_messages', 'personas_database']);

function isVirtual(name: string): boolean {
  return BUILTIN_CONNECTORS.has(name);
}

function findMatchingCredentials(
  connectorName: string,
  allCredentials: CredentialMetadata[],
): CredentialMetadata[] {
  return allCredentials.filter((c) => c.service_type === connectorName);
}

// -- Unresolved Component Card ------------------------------------------

export function UnresolvedComponentCard({
  connector,
  credentials,
  selectedCredentialId,
  onSetCredential,
  onClearCredential,
  onOpenInlineForm,
  onOpenDesign,
  onSwapConnector,
}: {
  connector: RequiredConnector;
  credentials: CredentialMetadata[];
  selectedCredentialId: string | undefined;
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onClearCredential: (connectorName: string) => void;
  onOpenInlineForm: (connectorName: string) => void;
  onOpenDesign: (connectorName: string) => void;
  onSwapConnector: (originalName: string, replacementName: string) => void;
}) {
  const builtIn = isVirtual(connector.activeName);
  const hasCredential = builtIn || !!selectedCredentialId;
  const matchingCreds = useMemo(
    () => findMatchingCredentials(connector.activeName, credentials),
    [connector.activeName, credentials],
  );

  const handleCredentialChange = useCallback(
    (val: string) => {
      if (val === '__create__') onOpenInlineForm(connector.activeName);
      else if (val === '__design__') onOpenDesign(connector.activeName);
      else if (val === '') onClearCredential(connector.activeName);
      else onSetCredential(connector.activeName, val);
    },
    [connector.activeName, onSetCredential, onClearCredential, onOpenInlineForm, onOpenDesign],
  );

  const handleConnectorSelect = useCallback(
    (selected: string) => onSwapConnector(connector.name, selected),
    [connector.name, onSwapConnector],
  );

  return (
    <div className={`rounded-xl border p-3 ${
      hasCredential ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/15 bg-secondary/20'
    }`}>
      {/* Role header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded-md bg-violet-500/10 border border-violet-500/15 flex items-center justify-center flex-shrink-0">
          <Box className="w-2.5 h-2.5 text-violet-400/70" />
        </div>
        <span className="text-sm font-semibold text-foreground/90 flex-1 truncate">{connector.roleLabel ?? getConnectorMeta(connector.activeName).label}</span>
        {hasCredential ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
        )}
      </div>

      {/* Connector selector (only if there are role members) */}
      {connector.roleMembers && connector.roleMembers.length > 1 && (
        <div className="mb-2">
          <ConnectorDropdown
            members={connector.roleMembers}
            activeName={connector.activeName}
            recommendedName={connector.name}
            onSelect={handleConnectorSelect}
            credentials={credentials}
          />
        </div>
      )}

      {/* Credential dropdown or built-in badge */}
      {builtIn ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span className="text-sm text-emerald-300/80">Built-in</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <ThemedSelect
            filterable
            value={selectedCredentialId ?? ''}
            onValueChange={handleCredentialChange}
            placeholder="Select credential..."
            options={[
              ...matchingCreds.map((cred) => ({ value: cred.id, label: cred.name })),
              { value: '__create__', label: '+ Create new credential' },
              { value: '__design__', label: '+ Design custom connector' },
            ]}
            className={`py-1.5 px-2.5 ${hasCredential ? 'border-emerald-500/15' : 'border-primary/10'}`}
          />
          {!hasCredential && matchingCreds.length === 0 && (
            <button
              type="button"
              onClick={() => onOpenInlineForm(connector.activeName)}
              className="flex items-center gap-1.5 px-2 py-1 text-sm text-violet-400/70 hover:text-violet-300 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add credential
            </button>
          )}
        </div>
      )}
    </div>
  );
}
