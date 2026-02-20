import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Square, CheckCircle2, XCircle, AlertTriangle, Upload, Plus, Trash2, FileText, Beaker, Copy, Check, Clock } from 'lucide-react';
import type { RunProgress } from '@/hooks/design/useDesignReviews';

type RunMode = 'predefined' | 'custom';

export interface PredefinedTestCase {
  id: string;
  name: string;
  instruction: string;
}

const PREDEFINED_TEST_CASES: PredefinedTestCase[] = [
  {
    id: 'gmail-filter',
    name: 'Gmail Smart Filter',
    instruction: 'Create an agent that monitors Gmail for important emails, categorizes them by sender and urgency, applies labels, and forwards urgent ones to Slack. Use polling trigger with gmail and slack connectors.',
  },
  {
    id: 'github-reviewer',
    name: 'GitHub PR Reviewer',
    instruction: 'Create an agent that automatically reviews pull requests for code quality, security issues, and best practices. Triggers on webhook when a PR is opened or updated. Uses github connector.',
  },
  {
    id: 'calendar-digest',
    name: 'Daily Calendar Digest',
    instruction: 'Create an agent that compiles a daily digest of upcoming meetings, prep notes, and schedule conflicts. Runs on a morning schedule trigger. Uses google_calendar connector and sends summary via email.',
  },
  {
    id: 'webhook-processor',
    name: 'Webhook Data Processor',
    instruction: 'Create an agent that receives webhook payloads, validates the data, transforms it, and routes it to the appropriate downstream system via HTTP requests. Uses webhook trigger and http connector.',
  },
  {
    id: 'multi-agent-coord',
    name: 'Multi-Agent Coordinator',
    instruction: 'Create an agent that orchestrates other personas by subscribing to their execution events, aggregating results, handling failures, and triggering follow-up actions. Uses event subscriptions for execution_completed and execution_failed events.',
  },
];

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animateFromRef = useRef(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<RunMode>('predefined');
  const [customInstructions, setCustomInstructions] = useState<string[]>(['']);
  const [copied, setCopied] = useState(false);

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

  const addInstruction = () => {
    setCustomInstructions((prev) => [...prev, '']);
  };

  const removeInstruction = (index: number) => {
    setCustomInstructions((prev) => prev.filter((_, i) => i !== index));
  };

  const updateInstruction = (index: number, value: string) => {
    setCustomInstructions((prev) => prev.map((v, i) => (i === index ? value : v)));
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
      const parsed = parseBulletPoints(text);
      if (parsed.length > 0) {
        setCustomInstructions(parsed);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleStart = () => {
    if (mode === 'predefined') {
      onStart({ testCases: PREDEFINED_TEST_CASES });
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
    const { current, total, startedAt } = runProgress;
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
    } else {
      const mins = Math.floor(etaSeconds / 60);
      const secs = etaSeconds % 60;
      eta = `~${mins}m ${secs}s remaining`;
    }
    return { current, total, pct, eta };
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
                <p className="text-xs text-muted-foreground/50">
                  {isRunning ? 'Running tests...' : result ? 'Review complete' : 'Configure and start a review run'}
                </p>
              </div>
            </div>
            {!isRunning && (
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-secondary/50 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground/50" />
              </button>
            )}
          </div>

          {/* Mode selection (hidden once started) */}
          {!hasStarted && (
            <div className="px-5 py-4 border-b border-primary/10 space-y-4">
              {/* Tabs */}
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('predefined')}
                  className={`px-4 py-2 text-sm rounded-xl border transition-all flex items-center gap-2 ${
                    mode === 'predefined'
                      ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
                      : 'bg-secondary/30 border-primary/10 text-muted-foreground/50 hover:border-primary/20'
                  }`}
                >
                  <Beaker className="w-3.5 h-3.5" />
                  Predefined (5 cases)
                </button>
                <button
                  onClick={() => setMode('custom')}
                  className={`px-4 py-2 text-sm rounded-xl border transition-all flex items-center gap-2 ${
                    mode === 'custom'
                      ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
                      : 'bg-secondary/30 border-primary/10 text-muted-foreground/50 hover:border-primary/20'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Custom
                </button>
              </div>

              {/* Predefined mode content */}
              {mode === 'predefined' && (
                <div className="text-xs text-muted-foreground/50 space-y-1">
                  <p>Runs {PREDEFINED_TEST_CASES.length} predefined use cases through the design engine:</p>
                  <ul className="list-disc list-inside text-muted-foreground/40 space-y-0.5 ml-1">
                    {PREDEFINED_TEST_CASES.map((tc) => (
                      <li key={tc.id}>{tc.name}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Custom mode content */}
              {mode === 'custom' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground/50">
                      Enter use case instructions ({validCustomCount} valid)
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.md"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 text-xs rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/50 transition-colors flex items-center gap-1.5"
                        title="Load from .txt or .md file (lines starting with '-')"
                      >
                        <Upload className="w-3 h-3" />
                        Load file
                      </button>
                      <button
                        onClick={addInstruction}
                        className="px-3 py-1.5 text-xs rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/50 transition-colors flex items-center gap-1.5"
                      >
                        <Plus className="w-3 h-3" />
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                    {customInstructions.map((instruction, index) => (
                      <div key={index} className="flex items-start gap-2">
                        <span className="text-xs text-muted-foreground/30 mt-2.5 w-5 text-right flex-shrink-0">
                          {index + 1}.
                        </span>
                        <textarea
                          value={instruction}
                          onChange={(e) => updateInstruction(index, e.target.value)}
                          placeholder="Describe a persona use case to test..."
                          rows={2}
                          className="flex-1 px-3 py-2 text-sm bg-secondary/30 border border-primary/10 rounded-lg text-foreground/80 placeholder:text-muted-foreground/30 resize-none focus:outline-none focus:border-violet-500/30 transition-colors"
                        />
                        {customInstructions.length > 1 && (
                          <button
                            onClick={() => removeInstruction(index)}
                            className="mt-2 p-1 rounded hover:bg-red-500/10 text-muted-foreground/30 hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <p className="text-[10px] text-muted-foreground/30">
                    Tip: Upload a .txt or .md file with bullet points (lines starting with &apos;-&apos;) to load multiple cases at once
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Progress Bar */}
          {isRunning && progressInfo && (
            <div className="px-5 py-3 border-b border-primary/10 bg-primary/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground/80">
                  Test {progressInfo.current} of {progressInfo.total}
                  <span className="text-muted-foreground/50 ml-1.5">— {progressInfo.pct}% complete</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
                  <Clock className="w-3 h-3" />
                  {progressInfo.eta}
                </span>
              </div>
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
              className={`${hasStarted ? 'h-[400px]' : 'h-[100px]'} overflow-y-auto font-mono text-xs bg-background transition-all`}
            >
              {!hasStarted ? (
                <div className="flex items-center justify-center h-full text-muted-foreground/30 text-xs">
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
                          line.includes('PASS') ? 'text-emerald-400/80' :
                          line.includes('FAIL') ? 'text-red-400/80' :
                          line.includes('ERROR') ? 'text-amber-400/80' :
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
                <span className="ml-auto text-muted-foreground/50 text-xs">
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
                disabled={mode === 'custom' && validCustomCount === 0}
                className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                {mode === 'predefined' ? 'Start Review (5 cases)' : `Start Review (${validCustomCount} case${validCustomCount !== 1 ? 's' : ''})`}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {lines.length > 0 && (
                  <button
                    onClick={handleCopyLog}
                    className="px-4 py-2 text-sm rounded-xl bg-secondary/50 text-muted-foreground/70 border border-primary/15 hover:bg-secondary/80 hover:text-foreground/80 transition-colors flex items-center gap-2"
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
