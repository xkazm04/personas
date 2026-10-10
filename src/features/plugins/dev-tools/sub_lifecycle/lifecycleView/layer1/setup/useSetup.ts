// The first-run setup's state: what auto-detection found (read once per
// project per session, from a module cache), the checklist built from it, the
// coverage suggestions, and the two ways out - save the checklist as the
// steps' commands and measure, or measure what is already in force.
//
// Nothing here writes until the reader presses Save and Measure: a suggestion
// joins the checklist, it is never saved on its own. The panel that holds this
// state is keyed by project (`Layer1`), so another project starts afresh. The result of a save or a
// Measure that would not start is said on the panel's own line, never a toast.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { detectLifecycleCommands, setLifecycleStepParams } from '@/api/devTools/lifecycle';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { LifecycleGateCommand } from '@/lib/bindings/LifecycleGateCommand';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { useMeasureNow } from '../../blocks/useMeasureNow';
import { useLifecycleViewModel } from '../../context';
import { draftProblem } from '../../presets/useCommandsEditor';
import {
  coverageTemplates, initialRows, isEdited, stepCommands, templateRow, type CoverageTemplate, type SetupRow,
} from './setupModel';

// What detection found, per project, this session. Bounded by the projects opened.
const detectedCache = createModuleCache<string, LifecycleGateCommand[]>({ maxSize: 32 });

/** Test-only: forget what detection found. */
export function __resetSetupCacheForTests(): void {
  detectedCache.clear();
}

export type DetectState = 'loading' | 'ready' | 'failed';

export interface SetupResult { tone: 'error'; text: string }

const message = (err: unknown) => resolveError(err instanceof Error ? err.message : String(err)).message;

export function useSetup() {
  const { projectId, snapshot, dl } = useLifecycleViewModel();
  const techStack = useSystemStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.tech_stack ?? null);
  const measureNow = useMeasureNow();
  const [detected, setDetected] = useState<LifecycleGateCommand[] | null>(() => (projectId ? detectedCache.get(projectId) ?? null : null));
  const [detect, setDetect] = useState<DetectState>(detected ? 'ready' : 'loading');
  const [detectError, setDetectError] = useState<string | null>(null);
  const [rows, setRows] = useState<SetupRow[]>([]);
  const start = useRef<SetupRow[] | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [gen, setGen] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    const warm = gen === 0 ? detectedCache.get(projectId) : undefined;
    if (warm) { setDetected(warm); setDetect('ready'); return; }
    let live = true;
    setDetect('loading');
    detectLifecycleCommands(projectId)
      .then((cmds) => {
        detectedCache.set(projectId, cmds);
        if (!live) return;
        setDetected(cmds);
        setDetect('ready');
      })
      .catch((err: unknown) => {
        silentCatch('lifecycle:detectCommands')(err);
        if (!live) return;
        setDetectError(message(err));
        setDetect('failed');
      });
    return () => { live = false; };
  }, [projectId, gen]);

  // The checklist starts once, when detection answers; a snapshot arriving later never resets the reader's edits.
  const ready = detect === 'ready' && !!snapshot;
  useEffect(() => {
    if (!ready || !snapshot || !detected || start.current) return;
    const first = initialRows(snapshot, detected);
    start.current = first;
    setRows(first);
  }, [ready, snapshot, detected]);

  const templates = useMemo(() => {
    const taken = new Set(rows.map((r) => r.templateId).filter(Boolean));
    // Suggested from what the repo itself shows (detected or pinned), never from a suggestion already taken.
    const base = rows.filter((r) => r.origin !== 'template');
    return taken.size > 0 ? [] : coverageTemplates(base, techStack);
  }, [rows, techStack]);

  const toggle = useCallback((key: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, on: !r.on } : r))), []);
  const setBudget = useCallback((key: string, budgetSec: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, budgetSec } : r))), []);
  const addTemplate = useCallback((t: CoverageTemplate) => setRows((rs) => [...rs, templateRow(t)]), []);
  const removeRow = useCallback((key: string) => setRows((rs) => rs.filter((r) => r.key !== key)), []);

  const saveAndMeasure = async () => {
    if (!projectId || !snapshot) return;
    if (rows.some((r) => r.on && draftProblem(r))) {
      setShowProblems(true);
      return;
    }
    setResult(null);
    setSaving(true);
    try {
      for (const [stepId, commands] of Object.entries(stepCommands(snapshot.rules, rows))) {
        const params = snapshot.steps.find((s) => s.step.id === stepId)?.step.params;
        if (params) await setLifecycleStepParams(projectId, stepId, { ...params, commands });
      }
    } catch (err) {
      silentCatch('lifecycle:setupSave')(err);
      setResult({ tone: 'error', text: `${dl.lcx10_setup_save_failed}: ${message(err)}` });
      setSaving(false);
      return;
    }
    setSaving(false);
    await measureNow.measure();
  };

  return {
    detect, detectError, retry: () => setGen((g) => g + 1),
    rows, templates, showProblems, saving,
    edited: start.current ? isEdited(start.current, rows) : false,
    toggle, setBudget, addTemplate, removeRow,
    saveAndMeasure,
    measureOnly: measureNow.measure,
    running: measureNow.running,
    refusal: measureNow.refusal,
    result,
  };
}

export type SetupState = ReturnType<typeof useSetup>;
