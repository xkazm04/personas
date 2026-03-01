import { useState, useCallback, useMemo, useEffect, useId, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import {
  Check,
  Circle,
  Copy,
  CheckCircle,
  ExternalLink,
  ChevronDown,
  ListChecks,
} from 'lucide-react';
import { openExternalUrl } from '@/api/tauriApi';
import { useStepProgress } from '@/hooks/useStepProgress';

interface InteractiveSetupInstructionsProps {
  markdown: string;
  firstSetupUrl: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────

/** Split markdown into logical step blocks by numbered list items or headings. */
function parseSteps(markdown: string): { preamble: string; steps: string[] } {
  const lines = markdown.split('\n');
  const steps: string[] = [];
  let preamble = '';
  let currentStep = '';
  let inSteps = false;

  for (const line of lines) {
    // Match numbered list items: "1. ", "2. ", "1) ", etc.
    const isNumberedItem = /^\s*\d+[.)]\s+/.test(line);

    if (isNumberedItem) {
      if (currentStep) {
        steps.push(currentStep.trim());
      }
      currentStep = line;
      inSteps = true;
    } else if (inSteps) {
      // Continuation of current step (indented lines, blank lines within step)
      if (line.trim() === '' && currentStep.trim() === '') {
        continue;
      }
      currentStep += '\n' + line;
    } else {
      preamble += line + '\n';
    }
  }

  if (currentStep.trim()) {
    steps.push(currentStep.trim());
  }

  return { preamble: preamble.trim(), steps };
}

// ── Copy button ─────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-sm transition-all ${
        copied
          ? 'text-emerald-400 bg-emerald-500/10'
          : 'text-muted-foreground/80 hover:text-foreground/95 hover:bg-secondary/60'
      } ${className ?? ''}`}
    >
      {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Custom markdown components with copy/link enhancements ──────

function buildComponents(onOpenUrl: (url: string) => void): Components {
  return {
    code: ({ className, children, ...props }) => {
      const text = extractText(children);
      const isBlock = className?.includes('language-');
      if (isBlock) {
        return (
          <div className="relative group my-2">
            <code
              className={`block p-3 bg-background/60 border border-primary/10 rounded-lg text-sm font-mono overflow-x-auto ${className || ''}`}
              {...props}
            >
              {children}
            </code>
            {text.trim() && (
              <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <CopyButton text={text.trim()} />
              </div>
            )}
          </div>
        );
      }
      return (
        <span className="inline-flex items-center gap-0.5">
          <code
            className="px-1.5 py-0.5 bg-secondary/60 border border-primary/10 rounded text-sm font-mono text-amber-300"
            {...props}
          >
            {children}
          </code>
          {text.trim().length > 4 && (
            <CopyButton text={text.trim()} className="ml-0.5" />
          )}
        </span>
      );
    },
    pre: ({ children }) => (
      <pre className="mb-2">{children}</pre>
    ),
    a: ({ href, children }) => {
      const url = href || '';
      return (
        <span className="inline-flex items-center gap-1">
          <button
            onClick={() => onOpenUrl(url)}
            className="text-primary hover:underline text-left inline-flex items-center gap-1"
          >
            {children}
            <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
          </button>
          <CopyButton text={url} />
        </span>
      );
    },
    p: ({ children }) => (
      <p className="text-sm text-foreground/80 my-1 leading-relaxed">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-inside space-y-0.5 my-1 text-sm text-foreground/80">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside space-y-0.5 my-1 text-sm text-foreground/80">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="text-foreground/80">{children}</li>
    ),
    h1: ({ children }) => (
      <h1 className="text-sm font-bold text-foreground mb-1.5 mt-2">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-sm font-semibold text-foreground/90 mb-1 mt-2">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-sm font-semibold text-foreground/80 mb-1 mt-1.5">{children}</h3>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    hr: () => <hr className="border-primary/10 my-2" />,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-primary/20 pl-3 italic text-foreground/90 my-2 text-sm">
        {children}
      </blockquote>
    ),
  };
}

/** Extract plain text from React children. */
function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

// ── Step card component ─────────────────────────────────────────

function StepCard({
  stepMarkdown,
  stepIndex,
  isCompleted,
  onToggle,
  components,
}: {
  stepMarkdown: string;
  stepIndex: number;
  isCompleted: boolean;
  onToggle: () => void;
  components: Components;
}) {
  // Strip the leading number (e.g. "1. " or "2) ")
  const content = stepMarkdown.replace(/^\s*\d+[.)]\s+/, '');

  return (
    <div
      className={`flex gap-2.5 px-3 py-2 rounded-lg transition-colors ${
        isCompleted ? 'bg-emerald-500/5' : 'bg-transparent hover:bg-secondary/20'
      }`}
    >
      {/* Checkmark button */}
      <button
        onClick={onToggle}
        className="mt-0.5 shrink-0 focus:outline-none"
        title={isCompleted ? 'Mark as not done' : 'Mark as done'}
      >
        {isCompleted ? (
          <CheckCircle className="w-4 h-4 text-emerald-400" />
        ) : (
          <Circle className="w-4 h-4 text-muted-foreground/80 hover:text-primary/50 transition-colors" />
        )}
      </button>

      {/* Step content */}
      <div className={`flex-1 min-w-0 ${isCompleted ? 'opacity-50' : ''}`}>
        <span className="text-sm font-bold text-muted-foreground/80 uppercase tracking-wider">
          Step {stepIndex + 1}
        </span>
        <div className="prose-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ── Persistence helpers ──────────────────────────────────────────

/** Fast string hash for localStorage keys. */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function readPersistedSteps(key: string): number[] {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved) as number[];
  } catch { /* ignore */ }
  return [];
}

// ── Main component ──────────────────────────────────────────────

export function InteractiveSetupInstructions({
  markdown,
  firstSetupUrl,
}: InteractiveSetupInstructionsProps) {
  const { preamble, steps } = useMemo(() => parseSteps(markdown), [markdown]);
  const hasSteps = steps.length > 0;

  const storageKey = useMemo(() => `setup-steps-${simpleHash(markdown)}`, [markdown]);

  // Default expanded when no persisted progress (first-time users)
  const [isOpen, setIsOpen] = useState(() => readPersistedSteps(storageKey).length === 0);

  const {
    completedSteps,
    completedCount,
    totalSteps,
    toggleStep: rawToggle,
  } = useStepProgress(steps.length);

  // Restore persisted step completions on mount
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = readPersistedSteps(storageKey);
    saved.forEach((i) => rawToggle(i));
    setRestored(true);
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps -- restore once on mount

  // Persist whenever completedSteps changes (after initial restore)
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...completedSteps]));
    } catch { /* quota exceeded — ignore */ }
  }, [completedSteps, storageKey, restored]);

  const toggleStep = rawToggle;

  // Unique ID for SVG gradient to prevent collision across instances
  const gradientId = useId();

  const handleOpenUrl = useCallback(async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const components = useMemo(() => buildComponents(handleOpenUrl), [handleOpenUrl]);

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
      {/* Header — clickable to expand/collapse */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-secondary/30 transition-colors"
      >
        <ListChecks className="w-3.5 h-3.5 text-foreground/90 shrink-0" />
        <span className="text-sm text-foreground/85 font-medium flex-1">
          Setup instructions
        </span>

        {/* Progress ring + badge */}
        {hasSteps && (
          <span className="inline-flex items-center gap-1.5">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              className="shrink-0 -rotate-90"
              data-testid="setup-progress-ring"
            >
              {/* Background track */}
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="text-secondary/40"
              />
              {/* Progress arc */}
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
                stroke={`url(#${gradientId})`}
                strokeDasharray={2 * Math.PI * 9}
                strokeDashoffset={totalSteps > 0 ? 2 * Math.PI * 9 * (1 - completedCount / totalSteps) : 2 * Math.PI * 9}
                style={{ transition: 'stroke-dashoffset 0.3s ease-out' }}
              />
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" style={{ stopColor: 'var(--color-primary)', stopOpacity: 0.6 }} />
                  <stop offset="100%" style={{ stopColor: 'rgb(16 185 129)', stopOpacity: 0.6 }} />
                </linearGradient>
              </defs>
            </svg>
            <span className={`text-sm font-medium px-1.5 py-0.5 rounded ${
              completedCount === totalSteps && totalSteps > 0
                ? 'bg-emerald-500/15 text-emerald-400'
                : completedCount > 0
                  ? 'bg-primary/10 text-primary/70'
                  : 'bg-secondary/50 text-muted-foreground/80'
            }`}>
              {completedCount}/{totalSteps}
            </span>
          </span>
        )}

        {/* Open setup page shortcut */}
        {firstSetupUrl && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              await handleOpenUrl(firstSetupUrl);
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm text-foreground/90 hover:text-foreground/95 hover:bg-secondary/60 transition-colors"
            title="Open setup page in browser"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            Open
          </button>
        )}

        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80" />
        </motion.div>
      </button>

      {/* Expandable content — animated height */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="setup-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">
              {/* Preamble (non-step content before the numbered list) */}
              {preamble && (
                <div className="px-3 py-2 mb-2 bg-background/40 rounded-lg border border-primary/10">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                    {preamble}
                  </ReactMarkdown>
                </div>
              )}

              {/* Interactive steps */}
              {hasSteps ? (
                <div className="space-y-0.5">
                  {steps.map((step, i) => (
                    <StepCard
                      key={i}
                      stepMarkdown={step}
                      stepIndex={i}
                      isCompleted={completedSteps.has(i)}
                      onToggle={() => toggleStep(i)}
                      components={components}
                    />
                  ))}

                  {/* All-done message */}
                  {completedCount === totalSteps && totalSteps > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 px-3 py-2 mt-1 rounded-lg bg-emerald-500/10 border border-emerald-500/15"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-sm text-emerald-300/80">
                        All steps complete — fill in the fields below and test your connection.
                      </span>
                    </motion.div>
                  )}
                </div>
              ) : (
                /* Fallback: render as plain enhanced markdown when no numbered steps detected */
                <div className="px-3 py-2 bg-background/40 rounded-lg border border-primary/10">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                    {markdown}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
