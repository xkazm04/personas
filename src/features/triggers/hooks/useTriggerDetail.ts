import { useState, useCallback, useRef, useEffect } from 'react';
import type { DryRunResult } from '@/api/triggers';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { useTriggerOperations } from './useTriggerOperations';

/**
 * Manages all async/interaction state for a single trigger's detail drawer:
 * test-fire, dry-run, activity log, delete confirmation, and clipboard.
 */
export function useTriggerDetail(triggerId: string, personaId: string) {
  const ops = useTriggerOperations(personaId);

  // -- Test fire --
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // -- Dry run --
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  // -- Activity --
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLog, setActivityLog] = useState<PersonaExecution[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // -- Delete confirmation --
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Clipboard --
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  // ── Test fire ──────────────────────────────────────────────────────────

  const handleTestFire = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await ops.testFire(triggerId);
      if (!result.ok) {
        setTestResult({ success: false, message: result.error ?? 'Failed to fire trigger' });
      } else if (result.data?.execution) {
        setTestResult({ success: true, message: `Config OK. Execution ${result.data.execution.id.slice(0, 8)} started` });
      } else if (result.data?.validationFailures) {
        setTestResult({ success: false, message: `Validation failed — ${result.data.validationFailures}` });
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Failed to fire trigger' });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 8000);
    }
  }, [triggerId, ops]);

  // ── Dry run ────────────────────────────────────────────────────────────

  const handleDryRun = useCallback(async () => {
    setDryRunning(true);
    setDryRunResult(null);
    try {
      const result = await ops.dryRun(triggerId);
      if (result.ok && result.data) {
        setDryRunResult(result.data);
      } else {
        setTestResult({ success: false, message: result.error ?? 'Dry run failed' });
        setTimeout(() => setTestResult(null), 8000);
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Dry run failed' });
      setTimeout(() => setTestResult(null), 8000);
    } finally {
      setDryRunning(false);
    }
  }, [triggerId, ops]);

  // ── Activity log ───────────────────────────────────────────────────────

  const toggleActivityLog = useCallback(async () => {
    if (activityOpen) {
      setActivityOpen(false);
      return;
    }
    setActivityOpen(true);
    setActivityLoading(true);
    try {
      const result = await ops.fetchActivity(triggerId);
      setActivityLog(result.ok && result.data ? result.data : []);
    } catch {
      setActivityLog([]);
    } finally {
      setActivityLoading(false);
    }
  }, [activityOpen, triggerId, ops]);

  // ── Delete confirmation ────────────────────────────────────────────────

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

  // ── Clipboard ──────────────────────────────────────────────────────────

  const copyWebhookUrl = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(`http://localhost:9420/webhook/${triggerId}`);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch { /* clipboard API fallback */ }
  }, [triggerId]);

  const copyCurlCommand = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `http://localhost:9420/webhook/${triggerId}`;
    const cmd = `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '{"test": true}'`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 2000);
    } catch { /* clipboard API fallback */ }
  }, [triggerId]);

  const clearDryRunResult = useCallback(() => setDryRunResult(null), []);

  return {
    // Test fire
    testing, testResult, handleTestFire,
    // Dry run
    dryRunning, dryRunResult, handleDryRun, clearDryRunResult,
    // Activity
    activityOpen, activityLog, activityLoading, toggleActivityLog,
    // Delete
    confirmingDelete, startDeleteConfirm, confirmDelete, cancelDelete,
    // Clipboard
    copiedUrl, copiedCurl, copyWebhookUrl, copyCurlCommand,
  } as const;
}
