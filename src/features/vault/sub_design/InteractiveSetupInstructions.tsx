import { useState, useCallback, useMemo, useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  ExternalLink,
  ChevronDown,
  ListChecks,
} from 'lucide-react';
import { openExternalUrl } from '@/api/tauriApi';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizeUrl';
import { useStepProgress } from '@/hooks/useStepProgress';
import { parseSteps, simpleHash, readPersistedSteps, ProgressRingBadge } from '@/features/vault/sub_design/setupInstructionHelpers';
import { buildComponents } from '@/features/vault/sub_design/setupMarkdownComponents';
import { SetupStepCard } from '@/features/vault/sub_design/SetupStepCard';

interface InteractiveSetupInstructionsProps {
  markdown: string;
  firstSetupUrl: string | null;
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
  }, [storageKey]);

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
    const safe = sanitizeExternalUrl(url);
    if (!safe) return;
    try {
      await openExternalUrl(safe);
    } catch {
      window.open(safe, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const components = useMemo(() => buildComponents(handleOpenUrl), [handleOpenUrl]);

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
      {/* Header — grouped controls with separate buttons */}
      <div className="w-full flex items-center gap-2 px-4 py-3 hover:bg-secondary/30 transition-colors" role="group" aria-label="Setup instruction controls">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 flex-1 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
        >
          <ListChecks className="w-3.5 h-3.5 text-foreground/90 shrink-0" />
          <span className="text-sm text-foreground/85 font-medium flex-1">
            Setup instructions
          </span>

          {/* Progress ring + badge */}
          {hasSteps && (
            <ProgressRingBadge
              gradientId={gradientId}
              completedCount={completedCount}
              totalSteps={totalSteps}
            />
          )}

          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.15 }}
          >
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80" />
          </motion.div>
        </button>

        {/* Open setup page shortcut */}
        {firstSetupUrl && (
          <button
            onClick={async () => {
              await handleOpenUrl(firstSetupUrl);
            }}
            className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm text-foreground/90 hover:text-foreground/95 hover:bg-secondary/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            title="Open setup page in browser"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            Open
          </button>
        )}
      </div>

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
                    <SetupStepCard
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
