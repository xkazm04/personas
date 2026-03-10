import { useState, useCallback, useMemo } from 'react';
import { getAuthMethods } from '@/lib/types/types';
import type { ConnectorDefinition } from '@/lib/types/types';
import { rotateCredentialNow } from '@/api/vault/rotation';

interface RotateAllOptions {
  credentials: { id: string; service_type: string }[];
  connectorDefinitions: ConnectorDefinition[];
  fetchCredentials: () => Promise<void>;
}

export function useRotateAll({ credentials, connectorDefinitions, fetchCredentials }: RotateAllOptions) {
  const [isRotatingAll, setIsRotatingAll] = useState(false);
  const [rotateAllResult, setRotateAllResult] = useState<{
    rotated: number;
    failed: number;
    skipped: number;
  } | null>(null);

  const isCredentialRotatable = useCallback((serviceType: string): boolean => {
    const connector = connectorDefinitions.find((c) => c.name === serviceType);
    if (!connector) return false;
    const methods = getAuthMethods(connector);
    return methods.some((m) => m.type === 'oauth');
  }, [connectorDefinitions]);

  const rotatableCount = useMemo(
    () => credentials.filter((c) => isCredentialRotatable(c.service_type)).length,
    [credentials, isCredentialRotatable],
  );

  const handleRotateAll = useCallback(async () => {
    setIsRotatingAll(true);
    setRotateAllResult(null);
    let rotated = 0;
    let failed = 0;
    const rotatable = credentials.filter((c) => isCredentialRotatable(c.service_type));
    const skipped = credentials.length - rotatable.length;
    for (const cred of rotatable) {
      try {
        await rotateCredentialNow(cred.id);
        rotated++;
      } catch {
        failed++;
      }
    }
    setRotateAllResult({ rotated, failed, skipped });
    setIsRotatingAll(false);
    void fetchCredentials();
    setTimeout(() => setRotateAllResult(null), 6000);
  }, [credentials, isCredentialRotatable, fetchCredentials]);

  return { isRotatingAll, rotateAllResult, rotatableCount, handleRotateAll };
}
