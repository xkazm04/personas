import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { useAgentStore } from '@/stores/agentStore';
import { createLogger } from '@/lib/log';

const logger = createLogger("matrix-tab");
import { PersonaMatrix } from '@/features/templates/sub_generated/gallery/matrix/PersonaMatrix';
import { answerBuildQuestion, testBuildDraft } from '@/api/agents/buildSession';
import { RefreshCw } from 'lucide-react';
import type { CellBuildStatus } from '@/lib/types/buildTypes';

interface BuildSessionSummary {
  id: string;
  personaId: string;
  phase: string;
  resolvedCells: Record<string, { items?: string[]; [k: string]: unknown }>;
  agentIr: unknown;
  intent: string;
  createdAt: string;
}

const DIMENSION_ORDER = ['use-cases', 'connectors', 'triggers', 'messages', 'human-review', 'memory', 'error-handling', 'events'];

export function MatrixTab() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const [session, setSession] = useState<BuildSessionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load build session data for this persona.
  // Use get_latest_build_session which includes promoted sessions — the original
  // get_active_build_session filters them out with `phase NOT IN (..., 'promoted')`,
  // which causes dimension data loss after promotion.
  useEffect(() => {
    if (!selectedPersona?.id) return;
    let cancelled = false;
    setIsLoading(true);

    invokeWithTimeout<BuildSessionSummary | null>('get_latest_build_session', { personaId: selectedPersona.id })
      .then((s) => {
        if (cancelled) return;
        setSession(s ?? null);
        // Hydrate buildCellData from session's resolvedCells so the matrix
        // displays the original template data (tasks, connectors, etc.)
        // instead of falling back to generic category extraction.
        if (s?.resolvedCells && Object.keys(s.resolvedCells).length > 0) {
          useAgentStore.setState({ buildCellData: s.resolvedCells });
        }
      })
      .catch(() => setSession(null))
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [selectedPersona?.id]);

  // Build designResult from session or persona data
  const designResult = useMemo(() => {
    if (!selectedPersona) return null;

    // Try persona's last_design_result first (always has the richest data after promote)
    if (selectedPersona.last_design_result) {
      try {
        return JSON.parse(selectedPersona.last_design_result);
      } catch { /* fall through */ }
    }
    return null;
  }, [selectedPersona?.last_design_result]);

  // Build cell states from session resolved_cells (all "resolved")
  const cellBuildStates = useMemo(() => {
    const states: Record<string, CellBuildStatus> = {};
    const cells = session?.resolvedCells;
    if (cells && typeof cells === 'object') {
      for (const key of DIMENSION_ORDER) {
        if (cells[key]) states[key] = 'resolved';
      }
    }
    // Fallback: if we have designResult with dimension data, mark all as resolved
    if (Object.keys(states).length === 0 && designResult) {
      for (const key of DIMENSION_ORDER) {
        if (designResult[key] || designResult[`suggested_${key.replace('-', '_')}`]) {
          states[key] = 'resolved';
        }
      }
      // Also check common patterns
      if (designResult.suggested_connectors) states['connectors'] = 'resolved';
      if (designResult.suggested_triggers) states['triggers'] = 'resolved';
      if (designResult.structured_prompt) {
        for (const key of DIMENSION_ORDER) states[key] = 'resolved';
      }
    }
    return states;
  }, [session?.resolvedCells, designResult]);

  // Refine handler — send feedback to adjust the persona
  const handleRefine = useCallback(async (feedback: string) => {
    if (!session?.id || !selectedPersona?.id) return;
    try {
      await answerBuildQuestion(session.id, '_refine', feedback);
      setHasUnsavedChanges(true);
    } catch (err) {
      logger.error('Matrix refine failed', { error: err });
    }
  }, [session?.id, selectedPersona?.id]);

  // Test handler
  const handleTest = useCallback(async () => {
    if (!session?.id || !selectedPersona?.id) return;
    try {
      await testBuildDraft(session.id, selectedPersona.id);
      setHasUnsavedChanges(true);
    } catch (err) {
      logger.error('Matrix test failed', { error: err });
    }
  }, [session?.id, selectedPersona?.id]);

  // Polling refs for future quick-execute feature
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);


  // Track whether user has made changes that warrant saving a new version
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Save version handler — creates a full persona snapshot
  const handleSaveVersion = useCallback(async () => {
    if (!selectedPersona?.id) return;
    try {
      await invokeWithTimeout('lab_create_version_snapshot', { personaId: selectedPersona.id });
      // Refresh persona data
      useAgentStore.getState().fetchPersonas();
    } catch {
      // Fallback: try the standard version creation path
      try {
        const persona = selectedPersona;
        await invokeWithTimeout('lab_tag_version', {
          id: selectedPersona.id,
          tag: 'production',
        });
        logger.info('Version saved', { personaName: persona.name });
      } catch (e2) {
        logger.error('Save version failed', { error: e2 });
      }
    }
  }, [selectedPersona?.id]);

  if (!selectedPersona) return null;

  if (isLoading) {
    return (
      <div className="py-8 text-center text-muted-foreground/50 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2" />
        Loading matrix...
      </div>
    );
  }

  const hasData = Object.keys(cellBuildStates).length > 0 || designResult;
  if (!hasData) {
    return (
      <div className="py-8 text-center text-muted-foreground/50 text-sm">
        No matrix data available. Build or rebuild this persona to generate dimensions.
      </div>
    );
  }

  return (
    <div data-testid="matrix-tab-container">
      <PersonaMatrix
        variant="saved"
        designResult={designResult}
        cellBuildStates={cellBuildStates}
        hasDesignResult={!!designResult}
        buildPhase={(session?.phase as 'draft_ready') || 'draft_ready'}
        completeness={100}
        onRefine={session ? handleRefine : undefined}
        onStartTest={session ? handleTest : undefined}
        onSaveVersion={hasUnsavedChanges ? handleSaveVersion : undefined}
        hideHeader
      />
    </div>
  );
}
