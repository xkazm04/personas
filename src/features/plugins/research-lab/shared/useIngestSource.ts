import { useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useAnnounce } from '@/features/shared/components/feedback/AriaLiveProvider';

/**
 * Mark a source as indexed. Wraps the two-step status flip with a single
 * busy-id, success toast, and failure rollback. The flag-flip is the
 * actual work — there is no real KB ingestion behind it today.
 */
export function useIngestSource(scope: string) {
  const updateSourceStatus = useSystemStore((s) => s.updateSourceStatus);
  const addToast = useToastStore((s) => s.addToast);
  const announce = useAnnounce();
  const { t } = useTranslation();
  const [ingestingId, setIngestingId] = useState<string | null>(null);

  const ingest = async (sourceId: string) => {
    setIngestingId(sourceId);
    // Start cue — the success/failure toasts already announce; this covers
    // the spinner-only window while the ingest runs.
    announce('Indexing source…', 'polite');
    try {
      await updateSourceStatus(sourceId, 'ingesting');
      await updateSourceStatus(sourceId, 'indexed');
      addToast(t.research_lab.source_indexed, 'success');
    } catch (err) {
      await updateSourceStatus(sourceId, 'failed').catch(silentCatch(`${scope}:rollback`));
      toastCatch(`${scope}:ingest`)(err);
    } finally {
      setIngestingId(null);
    }
  };

  return { ingestingId, ingest };
}
