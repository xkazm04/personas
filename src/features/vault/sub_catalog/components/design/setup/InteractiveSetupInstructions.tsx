import { useState, useCallback, useMemo, useEffect, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  ExternalLink,
  ChevronDown,
  ListChecks,
} from 'lucide-react';
import { openExternalUrl } from "@/api/system/system";

import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { useStepProgress } from '@/hooks/useStepProgress';
import { parseSteps, simpleHash, readPersistedSteps, ProgressRingBadge } from '@/features/vault/sub_catalog/components/design/setup/setupInstructionHelpers';
import { buildComponents } from '@/features/vault/sub_catalog/components/design/setup/setupMarkdownComponents';
import { SetupStepCard } from '@/features/vault/sub_catalog/components/design/setup/SetupStepCard';
import { useTranslation } from '@/i18n/useTranslation';

interface InteractiveSetupInstructionsProps {
  markdown: string;
  firstSetupUrl: string | null;
}

// -- Main component ----------------------------------------------

export function InteractiveSetupInstructions({
  markdown,
  firstSetupUrl,
}: InteractiveSetupInstructionsProps) {
  const { t } = useTranslation();
  const dp = t.vault.design_phases;
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
    } catch { /* intentional: non-critical -- localStorage fallback */ }
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
      // intentional: non-critical -- Tauri open fallback to window.open
      window.open(safe, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const components = useMemo(() => buildComponents(handleOpenUrl), [handleOpenUrl]);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/20 overflow-hidden">
      {/* Header -- grouped controls with separate buttons */}
      <div className="w-full flex items-center gap-2 px-4 py-3 hover:bg-secondary/30 transition-colors" role="group" aria-label={dp.setup_instructions}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 flex-1 text-left rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
        >
          <ListChecks className="w-3.5 h-3.5 text-foreground/90 shrink-0" />
          <span className="typo-body text-foreground/85 font-medium flex-1">
            {dp.setup_instructions}
          </span>

          {/* Progress ring + badge */}
          {hasSteps && (
            <ProgressRingBadge
              gradientId={gradientId}
              completedCount={completedCount}
              totalSteps={totalSteps}
            />
          )}

          <div className="animate-fade-in"
          >
            <ChevronDown className="w-3.5 h-3.5 text-foreground" />
          </div>
        </button>

        {/* Open setup page shortcut */}
        {firstSetupUrl && (
          <button
            onClick={async () => {
              await handleOpenUrl(firstSetupUrl);
            }}
            className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded typo-body text-foreground/90 hover:text-foreground/95 hover:bg-secondary/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            title={dp.open_setup_page}
          >
            <ExternalLink className="w-2.5 h-2.5" />
            Open
          </button>
        )}
      </div>

      {/* Expandable content -- animated height */}
      {isOpen && (
          <div
            key="setup-body"
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-4 pb-3">
              {/* Preamble (non-step content before the numbered list) */}
              {preamble && (
                <div className="px-3 py-2 mb-2 bg-background/40 rounded-modal border border-primary/10">
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
                    <div
                      className="animate-fade-slide-in flex items-center gap-2 px-3 py-2 mt-1 rounded-modal bg-emerald-500/10 border border-emerald-500/15"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="typo-body text-emerald-300/80">
                        {dp.all_steps_complete}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                /* Fallback: render as plain enhanced markdown when no numbered steps detected */
                <div className="px-3 py-2 bg-background/40 rounded-modal border border-primary/10">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                    {markdown}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
