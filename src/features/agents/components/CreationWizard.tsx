import { useState, useReducer } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Blocks, MessageCircle } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox } from '@/features/shared/components/ContentLayout';
import { ChatCreator } from '@/features/agents/components/ChatCreator';
import { BuilderStep, IdentityStep, builderReducer, INITIAL_BUILDER_STATE } from './creation';

type WizardStep = 'entry' | 'identity';
type EntryMode = 'build' | 'chat';

interface CreationWizardProps {
  canCancel?: boolean;
}

const pageTransition = { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

export default function CreationWizard({ canCancel }: CreationWizardProps) {
  const setIsCreatingPersona = usePersonaStore((s) => s.setIsCreatingPersona);

  const [step, setStep] = useState<WizardStep>('entry');
  const [entryMode, setEntryMode] = useState<EntryMode>('build');
  const [builderState, dispatch] = useReducer(builderReducer, INITIAL_BUILDER_STATE);
  const [draftPersonaId, setDraftPersonaId] = useState<string | null>(null);

  const handleCancel = () => {
    setIsCreatingPersona(false);
  };

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
              <div className="flex items-end justify-between mb-5 gap-6">
                <div>
                  <h2 className="text-lg font-semibold text-foreground/90">Create a New Agent</h2>
                  <p className="text-sm text-muted-foreground/90 mt-1">
                    Build your agent step by step, or design one through conversation.
                  </p>
                </div>

                <div className="flex border border-primary/15 rounded-xl overflow-hidden shrink-0">
                  <button
                    onClick={() => setEntryMode('build')}
                    className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                      entryMode === 'build'
                        ? 'bg-primary/10 text-foreground/90'
                        : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30'
                    }`}
                  >
                    <Blocks className="w-3.5 h-3.5" />
                    Build
                  </button>
                  <button
                    onClick={() => setEntryMode('chat')}
                    className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                      entryMode === 'chat'
                        ? 'bg-primary/10 text-foreground/90'
                        : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30'
                    }`}
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Chat
                  </button>
                </div>
              </div>

              {/* Mode content — fills remaining space */}
              <AnimatePresence mode="wait">
                {entryMode === 'chat' ? (
                  <motion.div
                    key="chat-creator"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="border border-primary/10 rounded-xl overflow-hidden bg-background/30"
                  >
                    <ChatCreator onCancel={canCancel ? handleCancel : undefined} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="builder"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <BuilderStep
                      state={builderState}
                      dispatch={dispatch}
                      onContinue={handleContinue}
                      onCancel={canCancel ? handleCancel : undefined}
                      draftPersonaId={draftPersonaId}
                      setDraftPersonaId={setDraftPersonaId}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="identity"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={pageTransition}
              className="flex items-start justify-center p-6"
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
