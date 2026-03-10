import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';

interface SaveFromRunFormProps {
  personaId: string;
  lastGeneratedScenarios: unknown[];
  lastRunId: string | null;
  onDone: () => void;
}

export function SaveFromRunForm({
  personaId,
  lastGeneratedScenarios,
  lastRunId,
  onDone,
}: SaveFromRunFormProps) {
  const createTestSuite = usePersonaStore((s) => s.createTestSuite);
  const [saveNameInput, setSaveNameInput] = useState('');

  const handleSaveFromRun = useCallback(async () => {
    if (lastGeneratedScenarios.length === 0) return;
    const name = saveNameInput.trim() || `Suite from ${new Date().toLocaleDateString()}`;
    const scenariosJson = JSON.stringify(lastGeneratedScenarios);
    await createTestSuite(personaId, name, scenariosJson, lastGeneratedScenarios.length, lastRunId ?? undefined);
    onDone();
    setSaveNameInput('');
  }, [lastGeneratedScenarios, saveNameInput, createTestSuite, personaId, lastRunId, onDone]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 space-y-3">
          <p className="text-sm text-muted-foreground/90">
            Save the {lastGeneratedScenarios.length} generated scenarios as a reusable test suite.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={saveNameInput}
              onChange={(e) => setSaveNameInput(e.target.value)}
              placeholder="Suite name (optional)"
              className="flex-1 px-3 py-2 rounded-xl text-sm bg-background/40 border border-primary/10 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30"
              data-testid="save-suite-name-input"
            />
            <button
              onClick={handleSaveFromRun}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary/15 text-primary hover:bg-primary/20 transition-colors"
              data-testid="save-suite-confirm-btn"
            >
              <Check className="w-3.5 h-3.5" />
              Save
            </button>
            <button
              onClick={onDone}
              className="p-2 rounded-lg text-muted-foreground/80 hover:bg-secondary/30 transition-colors"
              data-testid="save-suite-cancel-btn"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
