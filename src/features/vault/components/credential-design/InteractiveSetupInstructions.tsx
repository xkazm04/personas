import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
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

// ── Main component ──────────────────────────────────────────────

export function InteractiveSetupInstructions({
  markdown,
  firstSetupUrl,
}: InteractiveSetupInstructionsProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [isOpen, setIsOpen] = useState(false);

  const { preamble, steps } = useMemo(() => parseSteps(markdown), [markdown]);
  const hasSteps = steps.length > 0;
  const completedCount = completedSteps.size;
  const totalSteps = steps.length;

  const handleOpenUrl = useCallback(async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const components = useMemo(() => buildComponents(handleOpenUrl), [handleOpenUrl]);

  const toggleStep = useCallback((index: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

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

        {/* Progress badge */}
        {hasSteps && (
          <span className={`text-sm font-medium px-1.5 py-0.5 rounded ${
            completedCount === totalSteps && totalSteps > 0
              ? 'bg-emerald-500/15 text-emerald-400'
              : completedCount > 0
                ? 'bg-primary/10 text-primary/70'
                : 'bg-secondary/50 text-muted-foreground/80'
          }`}>
            {completedCount}/{totalSteps}
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

      {/* Expandable content */}
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="px-4 pb-3"
        >
          {/* Progress bar (only when there are steps) */}
          {hasSteps && totalSteps > 1 && (
            <div className="mb-3">
              <div className="h-1 bg-secondary/40 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0}%` }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="h-full bg-gradient-to-r from-primary/60 to-emerald-500/60 rounded-full"
                />
              </div>
            </div>
          )}

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
        </motion.div>
      )}
    </div>
  );
}
