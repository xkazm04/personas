import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CredentialCard } from './CredentialCard';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';

interface CredentialListProps {
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onDelete: (id: string) => void;
}

export function CredentialList({ credentials, connectorDefinitions, onDelete }: CredentialListProps) {
  const healthcheckCredential = usePersonaStore((s) => s.healthcheckCredential);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [healthchecking, setHealthchecking] = useState<string | null>(null);
  const [healthcheckResults, setHealthcheckResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const getConnectorForType = (type: string): ConnectorDefinition | undefined => {
    return connectorDefinitions.find(c => c.name === type);
  };

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
      {credentials.map((credential) => (
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

      {credentials.length === 0 && (
        <div className="text-center py-10 text-muted-foreground/40 text-sm">
          No credentials configured yet
        </div>
      )}
    </motion.div>
  );
}
