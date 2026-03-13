import { useState, useMemo, useCallback } from 'react';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useVaultStore } from "@/stores/vaultStore";
import { deleteDesignReview, cleanupDuplicateReviews, backfillServiceFlow, backfillRelatedTools } from '@/api/overview/reviews';
import { computeAdoptionReadiness } from '../../shared/adoptionReadiness';
import { getCachedDesignResult } from './reviewParseCache';
import type { CredentialModalTarget } from '../modals/TemplateModals';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

/**
 * Encapsulates admin actions (delete, cleanup, backfill),
 * readiness scoring, and credential modal state for the gallery.
 */
export function useGalleryActions(
  allItems: PersonaDesignReview[],
  total: number,
  sortBy: string,
  credentials: CredentialMetadata[],
  connectorDefinitions: ConnectorDefinition[],
  refresh: () => void,
) {
  // -- Readiness scoring --------------------------------------------
  const installedConnectorNames = useMemo(
    () => new Set(connectorDefinitions.map((c) => c.name)),
    [connectorDefinitions],
  );
  const credentialServiceTypes = useMemo(
    () => new Set(credentials.map((c) => c.service_type)),
    [credentials],
  );

  const isReadinessSort = sortBy === 'readiness';

  const readinessScores = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of allItems) {
      map.set(item.id, computeAdoptionReadiness(item, installedConnectorNames, credentialServiceTypes));
    }
    return map;
  }, [allItems, installedConnectorNames, credentialServiceTypes]);

  const coverageCounts = useMemo(() => {
    let ready = 0;
    let partial = 0;
    for (const [, score] of readinessScores) {
      if (score === 100) ready++;
      else if (score > 0) partial++;
    }
    return { all: total, ready, partial };
  }, [readinessScores, total]);

  const displayItems = useMemo(() => {
    if (!isReadinessSort) return allItems;
    return [...allItems].sort((a, b) => {
      const sa = readinessScores.get(a.id) ?? 0;
      const sb = readinessScores.get(b.id) ?? 0;
      if (sb !== sa) return sb - sa;
      return b.adoption_count - a.adoption_count;
    });
  }, [isReadinessSort, allItems, readinessScores]);

  // -- Credential modal ---------------------------------------------
  const [credentialModalTarget, setCredentialModalTarget] = useState<CredentialModalTarget | null>(null);

  const handleCredentialSave = useCallback(
    async (values: Record<string, string>) => {
      if (!credentialModalTarget) return;
      const meta = getConnectorMeta(credentialModalTarget.connectorName);
      await useVaultStore.getState().createCredential({
        name: `${meta.label} credential`,
        service_type: credentialModalTarget.connectorName,
        data: values,
      });
      setCredentialModalTarget(null);
    },
    [credentialModalTarget],
  );

  const handleAddCredential = useCallback(
    (connectorName: string, review: PersonaDesignReview) => {
      const designResult = getCachedDesignResult(review);
      const sugConn = designResult?.suggested_connectors?.find((sc) => sc.name === connectorName) ?? null;
      const connDef = connectorDefinitions.find((d) => d.name === connectorName) ?? null;
      setCredentialModalTarget({ connectorName, suggestedConnector: sugConn, connectorDefinition: connDef });
    },
    [connectorDefinitions],
  );

  // -- Admin actions ------------------------------------------------
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isBackfillingPipeline, setIsBackfillingPipeline] = useState(false);
  const [isBackfillingTools, setIsBackfillingTools] = useState(false);

  const handleDeleteReview = async (id: string) => {
    try { await deleteDesignReview(id); refresh(); }
    catch (err) { console.error('Failed to delete template:', err); }
  };

  const handleCleanupDuplicates = async () => {
    setIsCleaningUp(true);
    try { await cleanupDuplicateReviews(); refresh(); }
    catch (err) { console.error('Failed to cleanup duplicates:', err); }
    finally { setIsCleaningUp(false); }
  };

  const handleBackfillPipeline = async () => {
    setIsBackfillingPipeline(true);
    try { await backfillServiceFlow(); refresh(); }
    catch (err) { console.error('Failed to backfill service flow:', err); }
    finally { setIsBackfillingPipeline(false); }
  };

  const handleBackfillTools = async () => {
    setIsBackfillingTools(true);
    try { await backfillRelatedTools(); refresh(); }
    catch (err) { console.error('Failed to backfill related tools:', err); }
    finally { setIsBackfillingTools(false); }
  };

  return {
    installedConnectorNames,
    credentialServiceTypes,
    readinessScores,
    coverageCounts,
    displayItems,
    credentialModalTarget,
    clearCredentialModal: () => setCredentialModalTarget(null),
    handleCredentialSave,
    handleAddCredential,
    handleDeleteReview,
    isCleaningUp,
    handleCleanupDuplicates,
    isBackfillingPipeline,
    handleBackfillPipeline,
    isBackfillingTools,
    handleBackfillTools,
  };
}
