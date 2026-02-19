import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
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

      {filteredCredentials.length === 0 && (
        <div className="text-center py-10 text-muted-foreground/40 text-sm">
          {credentials.length === 0 ? 'No credentials configured yet' : 'No credentials match your search'}
        </div>
      )}
    </motion.div>
  );
}
