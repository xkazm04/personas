import { useState, useCallback, useRef, useEffect } from 'react';
import type { DryRunResult } from '@/api/pipeline/triggers';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { useTriggerOperations } from './useTriggerOperations';
import { getWebhookUrl } from '@/lib/utils/platform/triggerConstants';
import { toastCatch } from '@/lib/silentCatch';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Manages all async/interaction state for a single trigger's detail drawer:
 * test-fire, dry-run, activity log, delete confirmation, and clipboard.
 */
export function useTriggerDetail(triggerId: string, personaId: string) {
  const ops = useTriggerOperations(personaId);
  const { t, tx } = useTranslation();

  // -- Test fire --
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // -- Dry run --
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [dryRunError, setDryRunError] = useState<{ message: string } | null>(null);

  // -- Activity --
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLog, setActivityLog] = useState<PersonaExecution[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(false);

  // -- Delete confirmation --
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Clipboard --
  const { copied: copiedUrl, copy: copyUrl } = useCopyToClipboard();
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      if (testResultTimerRef.current) clearTimeout(testResultTimerRef.current);
    };
  }, []);

  // -- Test fire ----------------------------------------------------------

  const handleTestFire = useCallback(async () => {
    if (testResultTimerRef.current) clearTimeout(testResultTimerRef.current);
    setTesting(true);
    setTestResult(null);
    try {
      const result = await ops.testFire(triggerId);
      if (!result.ok) {
        setTestResult({ success: false, message: result.error ?? t.triggers.test_fire_failed });
      } else if (result.data?.execution) {
        setTestResult({ success: true, message: tx(t.triggers.test_fire_config_ok, { id: result.data.execution.id.slice(0, 8) }) });
      } else if (result.data?.validationFailures) {
        setTestResult({ success: false, message: tx(t.triggers.validation_failed_with_details, { failures: result.data.validationFailures }) });
      } else {
        setTestResult({ success: true, message: t.triggers.test_fire_fired });
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : t.triggers.test_fire_failed });
    } finally {
      setTesting(false);
      testResultTimerRef.current = setTimeout(() => setTestResult(null), 8000);
    }
  }, [triggerId, ops, t, tx]);

  // -- Dry run ------------------------------------------------------------

  const handleDryRun = useCallback(async () => {
    setDryRunning(true);
    setDryRunResult(null);
    setDryRunError(null);
    try {
      const result = await ops.dryRun(triggerId);
      if (result.ok && result.data) {
        setDryRunResult(result.data);
      } else {
        setDryRunError({ message: result.error ?? t.triggers.dry_run_failed });
        setTimeout(() => setDryRunError(null), 8000);
      }
    } catch (err) {
      setDryRunError({ message: err instanceof Error ? err.message : t.triggers.dry_run_failed });
      setTimeout(() => setDryRunError(null), 8000);
    } finally {
      setDryRunning(false);
    }
  }, [triggerId, ops, t]);

  // -- Activity log -------------------------------------------------------

  const toggleActivityLog = useCallback(async () => {
    if (activityOpen) {
      setActivityOpen(false);
      return;
    }
    setActivityOpen(true);
    setActivityLoading(true);
    setActivityError(false);
    try {
      const result = await ops.fetchActivity(triggerId);
      if (result.ok && result.data) {
        setActivityLog(result.data);
      } else {
        setActivityLog([]);
        setActivityError(true);
        toastCatch('useTriggerDetail:fetchActivity')(result.error);
      }
    } catch (err) {
      setActivityLog([]);
      setActivityError(true);
      toastCatch('useTriggerDetail:fetchActivity')(err);
    } finally {
      setActivityLoading(false);
    }
  }, [activityOpen, triggerId, ops]);

  const retryActivityLog = useCallback(async () => {
    setActivityLoading(true);
    setActivityError(false);
    try {
      const result = await ops.fetchActivity(triggerId);
      if (result.ok && result.data) {
        setActivityLog(result.data);
      } else {
        setActivityLog([]);
        setActivityError(true);
        toastCatch('useTriggerDetail:retryActivity')(result.error);
      }
    } catch (err) {
      setActivityLog([]);
      setActivityError(true);
      toastCatch('useTriggerDetail:retryActivity')(err);
    } finally {
      setActivityLoading(false);
    }
  }, [triggerId, ops]);

  // -- Delete confirmation ------------------------------------------------

  const startDeleteConfirm = useCallback(() => {
    setConfirmingDelete(true);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
  }, []);

  const confirmDelete = useCallback((onDelete: (id: string) => void) => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDelete(false);
    onDelete(triggerId);
  }, [triggerId]);

  const cancelDelete = useCallback(() => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDelete(false);
  }, []);

  // -- Clipboard ----------------------------------------------------------

  const copyWebhookUrl = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    copyUrl(getWebhookUrl(triggerId));
  }, [triggerId, copyUrl]);

  const copyCurlCommand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const url = getWebhookUrl(triggerId);
    const cmd = `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '{"test": true}'`;
    copyCurl(cmd);
  }, [triggerId, copyCurl]);

  const clearDryRunResult = useCallback(() => setDryRunResult(null), []);
  const clearDryRunError = useCallback(() => setDryRunError(null), []);

  return {
    // Test fire
    testing, testResult, handleTestFire,
    // Dry run
    dryRunning, dryRunResult, dryRunError, handleDryRun, clearDryRunResult, clearDryRunError,
    // Activity
    activityOpen, activityLog, activityLoading, activityError, toggleActivityLog, retryActivityLog,
    // Delete
    confirmingDelete, startDeleteConfirm, confirmDelete, cancelDelete,
    // Clipboard
    copiedUrl, copiedCurl, copyWebhookUrl, copyCurlCommand,
  } as const;
}
