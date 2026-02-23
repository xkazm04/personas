import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Square, CheckCircle2, XCircle, AlertTriangle, Copy, Check, Clock } from 'lucide-react';
import type { RunProgress } from '@/hooks/design/useDesignReviews';
import { parseListMdFormat, PREDEFINED_TEST_CASES, type PredefinedTestCase, type ParsedTemplate } from './designRunnerConstants';
import { PredefinedModePanel } from './PredefinedModePanel';
import { CustomModePanel } from './CustomModePanel';
import { BatchModePanel } from './BatchModePanel';

export type { PredefinedTestCase } from './designRunnerConstants';

type RunMode = 'predefined' | 'custom' | 'batch';

interface TestRunResult {
  testRunId: string;
  totalTests: number;
  passed: number;
  failed: number;
  errored: number;
}

interface DesignReviewRunnerProps {
  isOpen: boolean;
  onClose: () => void;
  lines: string[];
  isRunning: boolean;
  result: TestRunResult | null;
  runProgress: RunProgress | null;
  onStart: (options?: { customInstructions?: string[]; testCases?: PredefinedTestCase[] }) => void;
  onCancel: () => void;
}

export default function DesignReviewRunner({
  isOpen,
  onClose,
  lines,
  isRunning,
  result,
  runProgress,
  onStart,
  onCancel,
}: DesignReviewRunnerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const animateFromRef = useRef(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<RunMode>('predefined');
  const [customInstructions, setCustomInstructions] = useState<string[]>(['']);
  const [copied, setCopied] = useState(false);
  const [batchTemplates, setBatchTemplates] = useState<ParsedTemplate[]>([]);
  const [batchCategoryFilter, setBatchCategoryFilter] = useState<string | null>(null);

  // Capture the trigger element on open, restore focus on close
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [isOpen]);

  // Focus trap: keep Tab cycling within the modal
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
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // Auto-focus the first focusable element
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

  useEffect(() => {
    if (terminalRef.current && shouldAutoScroll.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  // Reset animation start index when a new run begins
  useEffect(() => {
    if (isRunning) {
      animateFromRef.current = lines.length;
    }
  }, [isRunning]);

  const handleScroll = () => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      shouldAutoScroll.current = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
    }
  };

  const parseBulletPoints = (text: string): string[] => {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('-'))
      .map((line) => line.slice(1).trim())
      .filter((line) => line.length > 0);
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') return;

      // Detect list.md format (numbered **N. Name** entries)
      if (/\*\*\d+\.\s+/.test(text)) {
        const templates = parseListMdFormat(text);
        if (templates.length > 0) {
          setBatchTemplates(templates);
          setBatchCategoryFilter(null);
          setMode('batch');
          return;
        }
      }

      // Fallback to bullet-point format
      const parsed = parseBulletPoints(text);
      if (parsed.length > 0) {
        setCustomInstructions(parsed);
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

  const handleStart = () => {
    if (mode === 'predefined') {
      onStart({ testCases: PREDEFINED_TEST_CASES });
    } else if (mode === 'batch') {
      const filtered = batchCategoryFilter
        ? batchTemplates.filter((t) => t.category === batchCategoryFilter)
        : batchTemplates;
      if (filtered.length === 0) return;
      onStart({
        testCases: filtered.map((t) => ({
          id: t.id,
          name: t.name,
          instruction: t.instruction,
          tools: t.tools,
          trigger: t.trigger,
          category: t.category,
        })),
      });
    } else {
      const validInstructions = customInstructions.filter((s) => s.trim().length > 0);
      if (validInstructions.length === 0) return;
      onStart({ customInstructions: validInstructions });
    }
  };

  const handleCopyLog = useCallback(() => {
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
    if (current === 0) {
      eta = 'Estimating...';
    } else if (etaSeconds < 60) {
      eta = `~${etaSeconds}s remaining`;
    } else if (etaSeconds < 3600) {
      const mins = Math.floor(etaSeconds / 60);
      const secs = etaSeconds % 60;
      eta = `~${mins}m ${secs}s remaining`;
    } else {
      const hrs = Math.floor(etaSeconds / 3600);
      const mins = Math.floor((etaSeconds % 3600) / 60);
      eta = `~${hrs}h ${mins}m remaining`;
    }
    return { current, total, pct, eta, currentTemplateName };
  }, [runProgress]);

  if (!isOpen) return null;

  const hasStarted = lines.length > 0 || isRunning;
  const validCustomCount = customInstructions.filter((s) => s.trim().length > 0).length;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && !isRunning && onClose()}
      >
        <motion.div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="design-runner-title"
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          className="w-[750px] max-h-[85vh] bg-background border border-primary/20 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-primary/10 bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Play className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <h3 id="design-runner-title" className="text-sm font-semibold text-foreground/90">Run Design Review</h3>
                <p className="text-sm text-muted-foreground/90">
                  {isRunning ? 'Running tests...' : result ? 'Review complete' : 'Configure and start a review run'}
                </p>
              </div>
            </div>
            {!isRunning && (
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-secondary/50 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground/90" />
              </button>
            )}
          </div>

          {/* Mode selection (hidden once started) */}
          {!hasStarted && (
            <div className="px-5 py-4 border-b border-primary/10 space-y-4">
              {/* Tabs */}
              <ModeTabBar mode={mode} onModeChange={setMode} batchCount={batchTemplates.length} />

              {mode === 'predefined' && <PredefinedModePanel />}
              {mode === 'custom' && (
                <CustomModePanel
                  instructions={customInstructions}
                  validCount={validCustomCount}
                  onAdd={() => setCustomInstructions((prev) => [...prev, ''])}
                  onRemove={(index) => setCustomInstructions((prev) => prev.filter((_, i) => i !== index))}
                  onUpdate={(index, value) => setCustomInstructions((prev) => prev.map((v, i) => (i === index ? value : v)))}
                  onFileUpload={handleFileUpload}
                />
              )}
              {mode === 'batch' && (
                <BatchModePanel
                  templates={batchTemplates}
                  categoryFilter={batchCategoryFilter}
                  onCategoryFilterChange={setBatchCategoryFilter}
                  onClear={() => {
                    setBatchTemplates([]);
                    setBatchCategoryFilter(null);
                  }}
                  onFileUpload={handleFileUpload}
                />
              )}
            </div>
          )}

          {/* Progress Bar */}
          {isRunning && progressInfo && (
            <div className="px-5 py-3 border-b border-primary/10 bg-primary/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-foreground/80">
                  Template {progressInfo.current} of {progressInfo.total}
                  <span className="text-muted-foreground/90 ml-1.5">— {progressInfo.pct}%</span>
                </span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground/90">
                  <Clock className="w-3 h-3" />
                  {progressInfo.eta}
                </span>
              </div>
              {progressInfo.currentTemplateName && (
                <p className="text-sm text-violet-400/70 mb-2 truncate">
                  Generating: {progressInfo.currentTemplateName}
                </p>
              )}
              <div className="w-full h-2 rounded-full bg-secondary/50 border border-primary/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-violet-500/80"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressInfo.pct}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
            </div>
          )}

          {/* Terminal */}
          <div className="flex-1 min-h-0">
            <div
              ref={terminalRef}
              onScroll={handleScroll}
              className={`${hasStarted ? 'h-[400px]' : 'h-[100px]'} overflow-y-auto font-mono text-sm bg-background transition-all`}
            >
              {!hasStarted ? (
                <div className="flex items-center justify-center h-full text-muted-foreground/80 text-sm">
                  Output will appear here when the review starts
                </div>
              ) : (
                <div className="p-3">
                  {lines.map((line, index) => {
                    const shouldAnimate = index >= animateFromRef.current;
                    const Wrapper = shouldAnimate ? motion.div : 'div';
                    const animProps = shouldAnimate ? {
                      initial: { opacity: 0, x: -4 },
                      animate: { opacity: 1, x: 0 },
                      transition: { delay: (index - animateFromRef.current) * 0.02, duration: 0.15 },
                    } : {};

                    return (
                      <Wrapper key={index} className="flex gap-2 py-px" {...animProps}>
                        <span className="text-muted-foreground/20 select-none flex-shrink-0 w-8 text-right">
                          {(index + 1).toString().padStart(3, ' ')}
                        </span>
                        <span className={`break-all ${
                          line.includes('PASSED') ? 'text-emerald-400/80' :
                          line.includes('FAILED') ? 'text-red-400/80' :
                          line.includes('ERROR') ? 'text-amber-400/80' :
                          line.includes('Generating:') ? 'text-violet-400/60' :
                          line.includes('Cancelled') ? 'text-orange-400/80' :
                          line.includes('[TestRunner]') ? 'text-violet-400/80' :
                          'text-blue-400/80'
                        }`}>{line}</span>
                      </Wrapper>
                    );
                  })}
                  {isRunning && (
                    <div className="flex items-center gap-2 py-1 text-blue-400/60">
                      <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                      <span>Running...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Result summary */}
          {result && (
            <div className="px-5 py-3 border-t border-primary/10 bg-primary/5">
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  {result.passed} passed
                </span>
                <span className="flex items-center gap-1.5 text-red-400">
                  <XCircle className="w-4 h-4" />
                  {result.failed} failed
                </span>
                <span className="flex items-center gap-1.5 text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                  {result.errored} errors
                </span>
                <span className="ml-auto text-muted-foreground/90 text-sm">
                  {result.totalTests} total tests
                </span>
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-primary/10">
            {isRunning ? (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors flex items-center gap-2"
              >
                <Square className="w-3.5 h-3.5" />
                Cancel
              </button>
            ) : !hasStarted ? (
              <button
                onClick={handleStart}
                disabled={
                  (mode === 'custom' && validCustomCount === 0) ||
                  (mode === 'batch' && filteredBatchTemplates.length === 0)
                }
                className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                {mode === 'predefined'
                  ? 'Start Review (5 cases)'
                  : mode === 'batch'
                    ? `Start Batch (${filteredBatchTemplates.length} template${filteredBatchTemplates.length !== 1 ? 's' : ''})`
                    : `Start Review (${validCustomCount} case${validCustomCount !== 1 ? 's' : ''})`}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {lines.length > 0 && (
                  <button
                    onClick={handleCopyLog}
                    className="px-4 py-2 text-sm rounded-xl bg-secondary/50 text-muted-foreground/90 border border-primary/15 hover:bg-secondary/80 hover:text-foreground/95 transition-colors flex items-center gap-2"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied!' : 'Copy Log'}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm rounded-xl bg-primary/10 text-foreground/80 border border-primary/20 hover:bg-primary/20 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Tab bar for mode selection
// ---------------------------------------------------------------------------

import { Beaker, FileText, List } from 'lucide-react';

function ModeTabBar({
  mode,
  onModeChange,
  batchCount,
}: {
  mode: RunMode;
  onModeChange: (m: RunMode) => void;
  batchCount: number;
}) {
  const tabs: { id: RunMode; label: string; Icon: typeof Beaker }[] = [
    { id: 'predefined', label: 'Predefined (5)', Icon: Beaker },
    { id: 'custom', label: 'Custom', Icon: FileText },
    { id: 'batch', label: `Batch${batchCount > 0 ? ` (${batchCount})` : ''}`, Icon: List },
  ];

  return (
    <div className="flex gap-2">
      {tabs.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onModeChange(id)}
          className={`px-4 py-2 text-sm rounded-xl border transition-all flex items-center gap-2 ${
            mode === id
              ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
              : 'bg-secondary/30 border-primary/10 text-muted-foreground/90 hover:border-primary/20'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
