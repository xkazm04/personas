/**
 * useDesignRunnerState — state and handlers for DesignReviewRunner modal.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { RunProgress } from '@/hooks/design/template/useDesignReviews';
import { parseListMdFormat, PREDEFINED_TEST_CASES, MIN_INSTRUCTION_LENGTH, type PredefinedTestCase, type CustomTemplateCase } from './designRunnerConstants';
import type { TemplateSource } from './TemplateSourcePanel';

type RunMode = 'predefined' | 'custom' | 'batch';

const EMPTY_CASE: CustomTemplateCase = { name: '', instruction: '' };

interface UseDesignRunnerStateOptions {
  isOpen: boolean;
  isRunning: boolean;
  lines: string[];
  runProgress: RunProgress | null;
  personaName?: string;
  onStart: (options?: { testCases?: PredefinedTestCase[] }) => void;
  onClose: () => void;
}

export function useDesignRunnerState({
  isOpen,
  isRunning,
  lines,
  runProgress,
  personaName,
  onStart,
  onClose,
}: UseDesignRunnerStateOptions) {
  const animateFromRef = useRef(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<RunMode>('predefined');
  const [customCases, setCustomCases] = useState<CustomTemplateCase[]>([{ ...EMPTY_CASE }]);
  const [copied, setCopied] = useState(false);
  const [batchTemplates, setBatchTemplates] = useState<TemplateSource[]>([]);
  const [batchCategoryFilter, setBatchCategoryFilter] = useState<string | null>(null);

  const hasPersona = !!personaName;
  const hasStarted = lines.length > 0 || isRunning;

  // Focus management
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [isOpen]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRunning) {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => {
      if (modalRef.current) {
        const first = modalRef.current.querySelector<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        first?.focus();
      }
    });
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRunning, onClose]);

  // Reset animation index on new run
  useEffect(() => {
    if (isRunning) { animateFromRef.current = lines.length; }
  }, [isRunning]);

  const parseBulletPoints = (text: string): string[] => {
    return text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('-')).map((l) => l.slice(1).trim()).filter((l) => l.length > 0);
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') return;
      if (/\*\*\d+\.\s+/.test(text)) {
        const templates = parseListMdFormat(text);
        if (templates.length > 0) { setBatchTemplates(templates); setBatchCategoryFilter(null); setMode('batch'); return; }
      }
      const parsed = parseBulletPoints(text);
      if (parsed.length > 0) {
        setCustomCases(parsed.map((instruction, i) => ({ name: `Template ${i + 1}`, instruction })));
        setMode('custom');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const filteredBatchTemplates = useMemo(() => {
    if (!batchCategoryFilter) return batchTemplates;
    return batchTemplates.filter((t) => t.category === batchCategoryFilter);
  }, [batchTemplates, batchCategoryFilter]);

  const validCustomCount = customCases.filter(
    (c) => c.name.trim().length > 0 && c.instruction.trim().length >= MIN_INSTRUCTION_LENGTH,
  ).length;

  const handleStart = useCallback(() => {
    if (!hasPersona) return;
    if (mode === 'predefined') {
      onStart({ testCases: PREDEFINED_TEST_CASES });
    } else if (mode === 'batch') {
      const filtered = batchCategoryFilter
        ? batchTemplates.filter((t) => t.category === batchCategoryFilter)
        : batchTemplates;
      if (filtered.length === 0) return;
      onStart({
        testCases: filtered.map((t) => ({
          id: t.id, name: t.name, instruction: t.instruction,
          tools: t.tools, trigger: t.trigger, category: t.category,
        })),
      });
    } else {
      const validCases = customCases.filter(
        (c) => c.name.trim().length > 0 && c.instruction.trim().length >= MIN_INSTRUCTION_LENGTH,
      );
      if (validCases.length === 0) return;
      onStart({
        testCases: validCases.map((c, i) => ({
          id: `custom_${i}`, name: c.name.trim(), instruction: c.instruction.trim(),
          category: c.category || undefined, trigger: c.trigger || undefined, tools: c.tools || undefined,
        })),
      });
    }
  }, [hasPersona, mode, batchCategoryFilter, batchTemplates, customCases, onStart]);

  const handleCopyLog = useCallback(() => {
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }, [lines]);

  const progressInfo = useMemo(() => {
    if (!runProgress) return null;
    const { current, total, startedAt, currentTemplateName } = runProgress;
    const pct = Math.round((current / total) * 100);
    const elapsed = Date.now() - startedAt;
    const msPerTest = current > 0 ? elapsed / current : 0;
    const remaining = Math.max(0, (total - current) * msPerTest);
    const etaSeconds = Math.ceil(remaining / 1000);
    let eta: string;
    if (current === 0) { eta = 'Estimating...'; }
    else if (etaSeconds < 60) { eta = `~${etaSeconds}s remaining`; }
    else if (etaSeconds < 3600) { const m = Math.floor(etaSeconds / 60); const s = etaSeconds % 60; eta = `~${m}m ${s}s remaining`; }
    else { const h = Math.floor(etaSeconds / 3600); const m = Math.floor((etaSeconds % 3600) / 60); eta = `~${h}h ${m}m remaining`; }
    return { current, total, pct, eta, currentTemplateName };
  }, [runProgress]);

  return {
    modalRef, animateFromRef,
    mode, setMode,
    customCases, setCustomCases,
    copied, handleCopyLog,
    batchTemplates, setBatchTemplates,
    batchCategoryFilter, setBatchCategoryFilter,
    hasPersona, hasStarted,
    filteredBatchTemplates, validCustomCount,
    handleStart, handleFileUpload, progressInfo,
  };
}
