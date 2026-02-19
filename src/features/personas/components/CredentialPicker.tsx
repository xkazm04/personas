import { Plug } from 'lucide-react';
import type { ConnectorDefinition } from '@/lib/types/types';

interface CredentialPickerProps {
  groupedConnectors: Record<string, ConnectorDefinition[]>;
  onPickType: (connector: ConnectorDefinition) => void;
}

export function CredentialPicker({ groupedConnectors, onPickType }: CredentialPickerProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground/60">Select a service type:</p>

      {Object.entries(groupedConnectors).map(([category, connectors]) => (
        <div key={category} className="space-y-2">
          <h4 className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-wider">
            {category}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {connectors.map((connector) => (
              <button
                key={connector.id}
                onClick={() => onPickType(connector)}
                className="group p-3 bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl hover:border-primary/30 hover:bg-secondary/60 transition-all text-left"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center border"
                    style={{
                      backgroundColor: `${connector.color}15`,
                      borderColor: `${connector.color}30`,
                    }}
                  >
                    {connector.icon_url ? (
                      <img src={connector.icon_url} alt={connector.label} className="w-5 h-5" />
                    ) : (
                      <Plug className="w-5 h-5" style={{ color: connector.color }} />
                    )}
                  </div>
                  <div>
                    <h4 className="font-medium text-foreground text-sm group-hover:text-primary transition-colors">
                      {connector.label}
                    </h4>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground/40 mt-1">
                  {connector.fields.length} field{connector.fields.length !== 1 ? 's' : ''}
                  {connector.services.length > 0 && (
                    <span> &middot; {connector.services.length} service{connector.services.length !== 1 ? 's' : ''}</span>
                  )}
                  {connector.events.length > 0 && (
                    <span> &middot; {connector.events.length} event{connector.events.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
