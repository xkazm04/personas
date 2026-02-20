import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { parseN8nWorkflow } from '@/lib/personas/n8nParser';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import {
  clearN8nTransformSnapshot,
  confirmN8nPersonaDraft,
  getN8nTransformSnapshot,
  startN8nTransformBackground,
  type N8nPersonaDraft,
} from '@/api/tauriApi';
import { usePersonaStore } from '@/stores/personaStore';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import {
  normalizeDraft,
  normalizeDraftFromUnknown,
  stringifyDraft,
  N8N_TRANSFORM_CONTEXT_KEY,
  type PersistedTransformContext,
} from '@/features/templates/sub_n8n/n8nTypes';
import { N8nUploadStep } from '@/features/templates/sub_n8n/N8nUploadStep';
import { N8nParserResults } from '@/features/templates/sub_n8n/N8nParserResults';
import { N8nTransformStep } from '@/features/templates/sub_n8n/N8nTransformStep';

export default function N8nImportTab() {
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const selectPersona = usePersonaStore((s) => s.selectPersona);

  const [error, setError] = useState<string | null>(null);
  const [parsedResult, setParsedResult] = useState<DesignAnalysisResult | null>(null);
  const [workflowName, setWorkflowName] = useState<string>('');
  const [rawWorkflowJson, setRawWorkflowJson] = useState<string>('');
  const [transforming, setTransforming] = useState(false);
  const [created, setCreated] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<N8nPersonaDraft | null>(null);
  const [draftJson, setDraftJson] = useState('');
  const [draftJsonError, setDraftJsonError] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [adjustmentRequest, setAdjustmentRequest] = useState('');
  const [backgroundTransformId, setBackgroundTransformId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const {
    runId: currentTransformId,
    phase: transformPhase,
    lines: transformLines,
    setLines: setTransformLines,
    start: startTransformStream,
    reset: resetTransformStream,
    setPhase: setTransformPhase,
  } = useCorrelatedCliStream({
    outputEvent: 'n8n-transform-output',
    statusEvent: 'n8n-transform-status',
    idField: 'transform_id',
    lineField: 'line',
    statusField: 'status',
    errorField: 'error',
    onFailed: (message) => setError(message),
  });

  useEffect(() => {
    if (!draft) return;
    setDraftJson(stringifyDraft(draft));
    setDraftJsonError(null);
  }, [draft]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(N8N_TRANSFORM_CONTEXT_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as PersistedTransformContext;
      if (!parsed?.transformId) return;

      setBackgroundTransformId(parsed.transformId);
      setWorkflowName(parsed.workflowName || 'Imported n8n Workflow');
      setRawWorkflowJson(parsed.rawWorkflowJson || '');
      setParsedResult(parsed.parsedResult || null);

      void startTransformStream(parsed.transformId);
    } catch {
      window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY);
    }
  }, [startTransformStream]);

  useEffect(() => {
    if (!backgroundTransformId) return;

    const syncSnapshot = async () => {
      try {
        const snapshot = await getN8nTransformSnapshot(backgroundTransformId);
        setTransformLines(snapshot.lines ?? []);
        if (snapshot.status === 'running' || snapshot.status === 'completed' || snapshot.status === 'failed') {
          setTransformPhase(snapshot.status);
        }

        if (snapshot.draft) {
          setDraft(normalizeDraft(snapshot.draft));
        }

        if (snapshot.status === 'running') {
          setTransforming(true);
          return;
        }

        setTransforming(false);
      } catch {
        // Snapshot may not exist yet or may have been cleared.
      }
    };

    void syncSnapshot();

    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    pollTimerRef.current = window.setInterval(() => {
      void syncSnapshot();
    }, 1500);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [backgroundTransformId, setTransformLines, setTransformPhase]);

  const updateDraft = useCallback((updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => {
    setDraft((current) => {
      if (!current) return current;
      return updater(current);
    });
  }, []);

  const processFile = useCallback((file: File) => {
    setError(null);
    setParsedResult(null);
    setCreated(false);
    setDraft(null);
    setDraftJson('');
    setDraftJsonError(null);
    setShowRawJson(false);
    setAdjustmentRequest('');

    if (!file.name.endsWith('.json')) {
      setError('Please upload a .json file exported from n8n.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const json = JSON.parse(content);
        const result = parseN8nWorkflow(json);
        setParsedResult(result);
        setWorkflowName(json.name || 'Imported n8n Workflow');
        setRawWorkflowJson(JSON.stringify(json, null, 2));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse workflow file.');
      }
    };
    reader.onerror = () => setError('Failed to read the file.');
    reader.readAsText(file);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleTransform = async () => {
    if (!parsedResult || !rawWorkflowJson || transforming || confirming) return;

    const transformId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await startTransformStream(transformId);

    setError(null);
    setTransforming(true);
    setTransformPhase('running');

    const previousDraftJson = draft ? stringifyDraft(draft) : draftJson.trim() || null;

    try {
      const context: PersistedTransformContext = {
        transformId,
        workflowName: workflowName || 'Imported n8n Workflow',
        rawWorkflowJson,
        parsedResult,
      };
      window.localStorage.setItem(N8N_TRANSFORM_CONTEXT_KEY, JSON.stringify(context));
      setBackgroundTransformId(transformId);

      await startN8nTransformBackground(
        transformId,
        workflowName || 'Imported n8n Workflow',
        rawWorkflowJson,
        JSON.stringify(parsedResult, null, 2),
        adjustmentRequest.trim() || null,
        previousDraftJson,
      );
      if (adjustmentRequest.trim()) {
        setAdjustmentRequest('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate transformation draft.');
      setTransformPhase('failed');
      setTransforming(false);
    }
  };

  const handleConfirmSave = async () => {
    const payloadJson = draft ? stringifyDraft(draft) : draftJson.trim();

    if (!payloadJson || transforming || confirming || (showRawJson && !!draftJsonError)) return;

    setError(null);
    setConfirming(true);

    try {
      const normalized = normalizeDraftFromUnknown(JSON.parse(payloadJson));
      if (!normalized) {
        setError('Draft JSON is invalid. Please fix draft fields before confirming save.');
        setConfirming(false);
        return;
      }

      const response = await confirmN8nPersonaDraft(stringifyDraft(normalized));
      await fetchPersonas();
      selectPersona(response.persona.id);
      setCreated(true);
      if (backgroundTransformId) {
        void clearN8nTransformSnapshot(backgroundTransformId);
      }
      window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY);
      setBackgroundTransformId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm and save persona.');
    } finally {
      setConfirming(false);
    }
  };

  const handleReset = () => {
    const snapshotId = backgroundTransformId || currentTransformId;
    if (snapshotId) {
      void clearN8nTransformSnapshot(snapshotId);
    }
    window.localStorage.removeItem(N8N_TRANSFORM_CONTEXT_KEY);

    setParsedResult(null);
    setError(null);
    setWorkflowName('');
    setRawWorkflowJson('');
    setTransforming(false);
    setCreated(false);
    setConfirming(false);
    setDraft(null);
    setDraftJson('');
    setDraftJsonError(null);
    setShowRawJson(false);
    setAdjustmentRequest('');
    setBackgroundTransformId(null);
    void resetTransformStream();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-6 overflow-y-auto h-full">
      {!parsedResult && (
        <N8nUploadStep fileInputRef={fileInputRef} onFileSelect={handleFileSelect} />
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20"
        >
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">Import Error</p>
            <p className="text-xs text-red-400/70 mt-0.5">{error}</p>
          </div>
        </motion.div>
      )}

      {parsedResult && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="space-y-4"
        >
          <N8nParserResults
            parsedResult={parsedResult}
            workflowName={workflowName}
            onReset={handleReset}
          />

          <div className="rounded-xl border border-primary/10 bg-secondary/20 divide-y divide-primary/10">
            <N8nTransformStep
              parsedResult={parsedResult}
              draft={draft}
              draftJson={draftJson}
              draftJsonError={draftJsonError}
              showRawJson={showRawJson}
              adjustmentRequest={adjustmentRequest}
              transforming={transforming}
              confirming={confirming}
              created={created}
              transformPhase={transformPhase}
              currentTransformId={currentTransformId}
              transformLines={transformLines}
              updateDraft={updateDraft}
              setDraft={setDraft}
              setDraftJson={setDraftJson}
              setDraftJsonError={setDraftJsonError}
              setShowRawJson={setShowRawJson}
              setAdjustmentRequest={setAdjustmentRequest}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTransform}
              disabled={!parsedResult || !rawWorkflowJson || transforming || confirming || created}
              className="flex-1 px-4 py-3 text-sm font-medium rounded-xl border transition-colors flex items-center justify-center gap-2 bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-50"
            >
              {transforming ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  {draft ? 'Applying Adjustment...' : 'Generating Draft...'}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {draft ? 'Apply Adjustment via Claude CLI' : 'Generate Draft via Claude CLI'}
                </>
              )}
            </button>

            <button
              onClick={handleConfirmSave}
              disabled={!draft || transforming || confirming || created || (showRawJson && !!draftJsonError)}
              className={`flex-1 px-4 py-3 text-sm font-medium rounded-xl border transition-colors flex items-center justify-center gap-2 ${
                created
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/20 disabled:opacity-50'
              }`}
            >
              {created ? (
                <>
                  <Check className="w-4 h-4" />
                  Persona Saved (Confirmed)
                </>
              ) : confirming ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Confirming Save...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Confirm & Save Persona
                </>
              )}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
