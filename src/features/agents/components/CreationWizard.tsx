import { useState, useReducer, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SVGProps } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { ChatCreator } from '@/features/agents/components/ChatCreator';
import { BuilderStep, IdentityStep, MatrixCreator, builderReducer, INITIAL_BUILDER_STATE } from './creation';
import { TRANSITION_SLOW, TRANSITION_FAST } from '@/features/templates/animationPresets';

const iconDefaults: SVGProps<SVGSVGElement> = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** Wrench assembling blocks */
function BuildIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconDefaults} {...props}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
      <path d="M10 3l2.5-1L14 4.5 13 7l-2-1" />
      <path d="M7 9l-1 2-2.5 1L2 10.5 3 8" />
    </svg>
  );
}

/** Speech bubbles forming a persona silhouette */
function ChatPersonaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M3 3h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H6l-2 1.5V9H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M12 6h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1v1.5L10 12H8" />
      <circle cx="5.5" cy="5.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="5.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Grid of agent avatars */
function MatrixAgentsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconDefaults} {...props}>
      <circle cx="4.5" cy="4" r="1.5" />
      <circle cx="11.5" cy="4" r="1.5" />
      <circle cx="4.5" cy="11" r="1.5" />
      <circle cx="11.5" cy="11" r="1.5" />
      <path d="M4.5 6v1.5h7V6" />
      <path d="M4.5 9v-1" />
      <path d="M11.5 9v-1" />
    </svg>
  );
}

type WizardStep = 'entry' | 'identity';
type EntryMode = 'build' | 'chat' | 'matrix';

interface CreationWizardProps {
  canCancel?: boolean;
}

const pageTransition = TRANSITION_SLOW;

export default function CreationWizard({ canCancel }: CreationWizardProps) {
  const setIsCreatingPersona = useSystemStore((s) => s.setIsCreatingPersona);
  const deletePersona = useAgentStore((s) => s.deletePersona);

  const [step, setStep] = useState<WizardStep>('entry');
  const [entryMode, setEntryMode] = useState<EntryMode>('matrix');
  const [builderState, dispatch] = useReducer(builderReducer, INITIAL_BUILDER_STATE);
  const [draftPersonaId, setDraftPersonaId] = useState<string | null>(null);
  const modeTabRefs = useRef<Partial<Record<EntryMode, HTMLButtonElement | null>>>({});

  const MODES: EntryMode[] = ['build', 'chat', 'matrix'];

  const handleModeKeyDown = useCallback((mode: EntryMode, e: React.KeyboardEvent<HTMLButtonElement>) => {
    let offset = 0;
    if (e.key === 'ArrowRight') offset = 1;
    else if (e.key === 'ArrowLeft') offset = -1;
    else if (e.key === 'Home') { e.preventDefault(); setEntryMode('build'); modeTabRefs.current.build?.focus(); return; }
    else if (e.key === 'End') { e.preventDefault(); setEntryMode('matrix'); modeTabRefs.current.matrix?.focus(); return; }
    else return;
    e.preventDefault();
    const idx = MODES.indexOf(mode);
    const next = MODES[(idx + offset + MODES.length) % MODES.length] as EntryMode;
    setEntryMode(next);
    modeTabRefs.current[next]?.focus();
  }, []);

  const handleCancel = useCallback(async () => {
    if (draftPersonaId) {
      try {
        await deletePersona(draftPersonaId);
      } catch {
        // intentional: non-critical -- best-effort cleanup for abandoned drafts
      }
      setDraftPersonaId(null);
    }
    setIsCreatingPersona(false);
  }, [deletePersona, draftPersonaId, setIsCreatingPersona]);

  const handleContinue = () => {
    setStep('identity');
  };

  const handleBack = () => {
    setStep('entry');
  };

  return (
    <ContentBox minWidth={0}>
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {step === 'entry' ? (
            <motion.div
              key="entry"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={pageTransition}
              className="p-6 h-full"
            >
              {/* Header + mode tabs */}
              <div className="flex items-end justify-between mb-6 gap-6">
                <div>
                  <h2 className="text-lg font-semibold text-foreground/90">Create a New Agent</h2>
                  <p className="text-sm text-muted-foreground/90 mt-1">
                    Build your agent step by step, or design one through conversation.
                  </p>
                </div>

                <div className="flex border border-primary/20 rounded-xl overflow-hidden shrink-0" role="tablist" aria-label="Creation mode">
                  <button
                    ref={(el) => { modeTabRefs.current.build = el; }}
                    onClick={() => setEntryMode('build')}
                    onKeyDown={(e) => handleModeKeyDown('build', e)}
                    role="tab"
                    id="wizard-tab-build"
                    aria-selected={entryMode === 'build'}
                    aria-controls="wizard-tabpanel"
                    tabIndex={entryMode === 'build' ? 0 : -1}
                    className="relative flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium"
                  >
                    {entryMode === 'build' && (
                      <motion.div
                        layoutId="wizard-mode-pill"
                        className="absolute inset-0 bg-gradient-to-r from-primary/10 to-accent/10 rounded-xl"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                    <span className={`relative z-10 flex items-center gap-2 transition-colors ${
                      entryMode === 'build'
                        ? 'text-foreground/90'
                        : 'text-muted-foreground/70 hover:text-muted-foreground'
                    }`}>
                      <BuildIcon className="w-3.5 h-3.5" />
                      Build
                    </span>
                  </button>
                  <button
                    ref={(el) => { modeTabRefs.current.chat = el; }}
                    onClick={() => setEntryMode('chat')}
                    onKeyDown={(e) => handleModeKeyDown('chat', e)}
                    role="tab"
                    id="wizard-tab-chat"
                    aria-selected={entryMode === 'chat'}
                    aria-controls="wizard-tabpanel"
                    tabIndex={entryMode === 'chat' ? 0 : -1}
                    className={`relative flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                      entryMode === 'chat'
                        ? 'text-foreground/90'
                        : 'text-muted-foreground/70 hover:text-muted-foreground'
                    }`}
                  >
                    {entryMode === 'chat' && (
                      <motion.div
                        layoutId="wizard-mode-pill"
                        className="absolute inset-0 bg-gradient-to-r from-primary/10 to-accent/10 rounded-xl"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      <ChatPersonaIcon className="w-3.5 h-3.5" />
                      Chat
                    </span>
                  </button>
                  <button
                    ref={(el) => { modeTabRefs.current.matrix = el; }}
                    onClick={() => setEntryMode('matrix')}
                    onKeyDown={(e) => handleModeKeyDown('matrix', e)}
                    role="tab"
                    id="wizard-tab-matrix"
                    aria-selected={entryMode === 'matrix'}
                    aria-controls="wizard-tabpanel"
                    tabIndex={entryMode === 'matrix' ? 0 : -1}
                    className={`relative flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                      entryMode === 'matrix'
                        ? 'text-foreground/90'
                        : 'text-muted-foreground/70 hover:text-muted-foreground'
                    }`}
                  >
                    {entryMode === 'matrix' && (
                      <motion.div
                        layoutId="wizard-mode-pill"
                        className="absolute inset-0 bg-gradient-to-r from-primary/10 to-accent/10 rounded-xl"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      <MatrixAgentsIcon className="w-3.5 h-3.5" />
                      Matrix
                    </span>
                  </button>
                </div>
              </div>

              {/* Mode content -- fills remaining space */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={entryMode}
                  role="tabpanel"
                  id="wizard-tabpanel"
                  aria-labelledby={`wizard-tab-${entryMode}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={TRANSITION_FAST}
                  className={entryMode === 'chat' ? 'border border-primary/20 rounded-xl overflow-hidden bg-background/30' : undefined}
                >
                  {entryMode === 'chat' ? (
                    <ChatCreator
                      onCancel={canCancel ? () => { void handleCancel(); } : undefined}
                      onCreated={(id) => setDraftPersonaId(id)}
                      onActivated={() => setIsCreatingPersona(false)}
                    />
                  ) : entryMode === 'matrix' ? (
                    <MatrixCreator
                      state={builderState}
                      dispatch={dispatch}
                      onContinue={handleContinue}
                      onCancel={canCancel ? () => { void handleCancel(); } : undefined}
                      draftPersonaId={draftPersonaId}
                      setDraftPersonaId={setDraftPersonaId}
                    />
                  ) : (
                    <BuilderStep
                      state={builderState}
                      dispatch={dispatch}
                      onContinue={handleContinue}
                      onCancel={canCancel ? () => { void handleCancel(); } : undefined}
                      draftPersonaId={draftPersonaId}
                      setDraftPersonaId={setDraftPersonaId}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="identity"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={pageTransition}
              className="p-6"
            >
              <IdentityStep
                builderState={builderState}
                onBack={handleBack}
                draftPersonaId={draftPersonaId}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ContentBox>
  );
}
