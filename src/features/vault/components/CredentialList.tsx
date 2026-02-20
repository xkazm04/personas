import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Key, LayoutTemplate, Plus } from 'lucide-react';
import { CredentialCard } from '@/features/vault/components/CredentialCard';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';

interface CredentialListProps {
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  searchTerm?: string;
  onDelete: (id: string) => void;
}

export function CredentialList({ credentials, connectorDefinitions, searchTerm, onDelete }: CredentialListProps) {
  const healthcheckCredential = usePersonaStore((s) => s.healthcheckCredential);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [healthchecking, setHealthchecking] = useState<string | null>(null);
  const [healthcheckResults, setHealthcheckResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const getConnectorForType = (type: string): ConnectorDefinition | undefined => {
    return connectorDefinitions.find(c => c.name === type);
  };

  const filteredCredentials = credentials.filter((credential) => {
    const q = (searchTerm ?? '').trim().toLowerCase();
    if (!q) return true;
    const connector = getConnectorForType(credential.service_type);
    return (
      credential.name.toLowerCase().includes(q)
      || credential.service_type.toLowerCase().includes(q)
      || connector?.label.toLowerCase().includes(q)
    );
  });

  const handleHealthcheck = useCallback(async (credentialId: string) => {
    setHealthchecking(credentialId);
    try {
      const result = await healthcheckCredential(credentialId);
      setHealthcheckResults(prev => ({ ...prev, [credentialId]: result }));
    } finally {
      setHealthchecking(null);
    }
  }, [healthcheckCredential]);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <motion.div
      key="list"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-2"
    >
      {filteredCredentials.map((credential) => (
        <CredentialCard
          key={credential.id}
          credential={credential}
          connector={getConnectorForType(credential.service_type)}
          isExpanded={expandedId === credential.id}
          onToggleExpand={() => toggleExpand(credential.id)}
          onDelete={onDelete}
          onHealthcheck={handleHealthcheck}
          isHealthchecking={healthchecking === credential.id}
          healthcheckResult={healthcheckResults[credential.id] || null}
        />
      ))}

      {filteredCredentials.length === 0 && credentials.length > 0 && (
        <div className="text-center py-10 text-muted-foreground/40 text-sm">
          No credentials match your search
        </div>
      )}

      {credentials.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center py-16 text-center"
        >
          <div className="w-14 h-14 rounded-2xl bg-secondary/60 border border-primary/15 flex items-center justify-center mb-4">
            <Key className="w-7 h-7 text-muted-foreground/60" />
          </div>
          <h3 className="text-sm font-medium text-foreground/70 mb-1">No credentials configured yet</h3>
          <p className="text-xs text-muted-foreground/50 max-w-xs">
            Add your first credential to connect external services
          </p>
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => usePersonaStore.getState().setCredentialView('from-template')}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-secondary/60 border border-primary/15 text-foreground/70 hover:bg-secondary transition-colors"
            >
              <LayoutTemplate className="w-3.5 h-3.5" />
              From Template
            </button>
            <button
              onClick={() => usePersonaStore.getState().setCredentialView('add-new')}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Design New
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
