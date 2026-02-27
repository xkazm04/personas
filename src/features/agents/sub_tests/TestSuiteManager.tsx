import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Play, Trash2, ChevronDown, ChevronRight, Save,
  Pencil, X, Check, FileText,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { PersonaTestSuite } from '@/lib/bindings/PersonaTestSuite';
import type { TestSuiteScenario } from '@/lib/bindings/TestSuiteScenario';

interface TestSuiteManagerProps {
  personaId: string;
  onRunSuite: (suiteId: string) => void;
  /** Raw scenarios from the last "generated" event, available to save */
  lastGeneratedScenarios: unknown[] | null;
  lastRunId: string | null;
  disabled?: boolean;
}

export function TestSuiteManager({
  personaId,
  onRunSuite,
  lastGeneratedScenarios,
  lastRunId,
  disabled,
}: TestSuiteManagerProps) {
  const testSuites = usePersonaStore((s) => s.testSuites);
  const fetchTestSuites = usePersonaStore((s) => s.fetchTestSuites);
  const createTestSuite = usePersonaStore((s) => s.createTestSuite);
  const deleteTestSuite = usePersonaStore((s) => s.deleteTestSuite);
  const updateTestSuite = usePersonaStore((s) => s.updateTestSuite);

  const [expandedSuiteId, setExpandedSuiteId] = useState<string | null>(null);
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingFromRun, setSavingFromRun] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');

  useEffect(() => {
    fetchTestSuites(personaId);
  }, [personaId, fetchTestSuites]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedSuiteId((prev) => (prev === id ? null : id));
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await deleteTestSuite(id);
    if (expandedSuiteId === id) setExpandedSuiteId(null);
  }, [deleteTestSuite, expandedSuiteId]);

  const handleStartRename = useCallback((suite: PersonaTestSuite) => {
    setEditingSuiteId(suite.id);
    setEditName(suite.name);
  }, []);

  const handleSaveRename = useCallback(async () => {
    if (!editingSuiteId || !editName.trim()) return;
    await updateTestSuite(editingSuiteId, editName.trim());
    setEditingSuiteId(null);
  }, [editingSuiteId, editName, updateTestSuite]);

  const handleCancelRename = useCallback(() => {
    setEditingSuiteId(null);
  }, []);

  const handleSaveFromRun = useCallback(async () => {
    if (!lastGeneratedScenarios || lastGeneratedScenarios.length === 0) return;
    const name = saveNameInput.trim() || `Suite from ${new Date().toLocaleDateString()}`;
    const scenariosJson = JSON.stringify(lastGeneratedScenarios);
    await createTestSuite(personaId, name, scenariosJson, lastGeneratedScenarios.length, lastRunId ?? undefined);
    setSavingFromRun(false);
    setSaveNameInput('');
  }, [lastGeneratedScenarios, saveNameInput, createTestSuite, personaId, lastRunId]);

  const handleRemoveScenario = useCallback(async (suiteId: string, scenarioIndex: number) => {
    const suite = testSuites.find((s) => s.id === suiteId);
    if (!suite) return;
    try {
      const scenarios: TestSuiteScenario[] = JSON.parse(suite.scenarios);
      scenarios.splice(scenarioIndex, 1);
      await updateTestSuite(suiteId, undefined, undefined, JSON.stringify(scenarios), scenarios.length);
    } catch {
      // Invalid JSON — skip
    }
  }, [testSuites, updateTestSuite]);

  const canSave = lastGeneratedScenarios && lastGeneratedScenarios.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          <BookOpen className="w-3.5 h-3.5" />
          Saved Test Suites
        </h4>
        {canSave && (
          <button
            onClick={() => setSavingFromRun(true)}
            disabled={disabled || savingFromRun}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="save-suite-from-run-btn"
          >
            <Save className="w-3.5 h-3.5" />
            Save Scenarios
          </button>
        )}
      </div>

      {/* Save from run form */}
      <AnimatePresence>
        {savingFromRun && canSave && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 space-y-3">
              <p className="text-sm text-muted-foreground/90">
                Save the {lastGeneratedScenarios!.length} generated scenarios as a reusable test suite.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={saveNameInput}
                  onChange={(e) => setSaveNameInput(e.target.value)}
                  placeholder="Suite name (optional)"
                  className="flex-1 px-3 py-2 rounded-lg text-sm bg-background/40 border border-primary/10 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30"
                  data-testid="save-suite-name-input"
                />
                <button
                  onClick={handleSaveFromRun}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary/15 text-primary hover:bg-primary/20 transition-colors"
                  data-testid="save-suite-confirm-btn"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save
                </button>
                <button
                  onClick={() => { setSavingFromRun(false); setSaveNameInput(''); }}
                  className="p-2 rounded-lg text-muted-foreground/80 hover:bg-secondary/30 transition-colors"
                  data-testid="save-suite-cancel-btn"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Suite list */}
      {testSuites.length === 0 ? (
        <div className="text-center py-8 bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl">
          <div className="w-12 h-12 rounded-2xl bg-primary/8 border border-primary/12 flex items-center justify-center mx-auto mb-3">
            <BookOpen className="w-6 h-6 text-primary/40" />
          </div>
          <p className="text-sm text-muted-foreground/80">No saved test suites</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            Run a test to generate scenarios, then save them here
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {testSuites.map((suite) => {
            const isExpanded = expandedSuiteId === suite.id;
            const isEditing = editingSuiteId === suite.id;
            let scenarios: TestSuiteScenario[] = [];
            try { scenarios = JSON.parse(suite.scenarios); } catch { /* skip */ }

            return (
              <div key={suite.id} className="border border-primary/10 rounded-xl overflow-hidden">
                {/* Suite header */}
                <div className="flex items-center gap-2 px-4 py-3 bg-background/30 hover:bg-secondary/20 transition-colors">
                  <button
                    onClick={() => toggleExpand(suite.id)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    data-testid={`suite-expand-${suite.id}`}
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />}

                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(); if (e.key === 'Escape') handleCancelRename(); }}
                            className="flex-1 px-2 py-0.5 rounded text-sm bg-background/40 border border-primary/20 text-foreground focus:outline-none focus:border-primary/40"
                            autoFocus
                            data-testid={`suite-rename-input-${suite.id}`}
                          />
                          <button onClick={handleSaveRename} className="p-1 text-primary" data-testid={`suite-rename-save-${suite.id}`}>
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={handleCancelRename} className="p-1 text-muted-foreground" data-testid={`suite-rename-cancel-${suite.id}`}>
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground/80 font-medium truncate">{suite.name}</span>
                          <span className="text-sm text-muted-foreground/70">
                            {suite.scenarioCount} scenario{suite.scenarioCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                      <div className="text-sm text-muted-foreground/60 mt-0.5">
                        {new Date(suite.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onRunSuite(suite.id)}
                      disabled={disabled}
                      className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/70 hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Re-run this suite"
                      data-testid={`suite-run-${suite.id}`}
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleStartRename(suite)}
                      disabled={disabled}
                      className="p-1.5 rounded-lg hover:bg-secondary/30 text-muted-foreground/80 hover:text-foreground transition-colors disabled:opacity-40"
                      title="Rename"
                      data-testid={`suite-rename-${suite.id}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(suite.id)}
                      disabled={disabled}
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground/80 hover:text-red-400 transition-colors disabled:opacity-40"
                      title="Delete suite"
                      data-testid={`suite-delete-${suite.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded scenario list */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t border-primary/10 bg-secondary/10"
                    >
                      <div className="p-4 space-y-2">
                        {scenarios.length === 0 ? (
                          <p className="text-sm text-muted-foreground/60 text-center py-4">No scenarios in this suite</p>
                        ) : (
                          scenarios.map((scenario, idx) => (
                            <div
                              key={`${scenario.name}-${idx}`}
                              className="flex items-start gap-3 p-3 rounded-lg bg-background/20 border border-primary/5"
                            >
                              <FileText className="w-4 h-4 text-primary/40 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-foreground/80">{scenario.name}</div>
                                <p className="text-sm text-muted-foreground/70 mt-0.5 line-clamp-2">{scenario.description}</p>
                                {scenario.expectedToolSequence && scenario.expectedToolSequence.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {scenario.expectedToolSequence.map((tool) => (
                                      <span key={tool} className="px-1.5 py-0.5 text-[11px] rounded bg-primary/10 text-primary/70">
                                        {tool}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => handleRemoveScenario(suite.id, idx)}
                                disabled={disabled}
                                className="p-1 rounded hover:bg-red-500/15 text-muted-foreground/50 hover:text-red-400 transition-colors flex-shrink-0 disabled:opacity-40"
                                title="Remove scenario"
                                data-testid={`scenario-remove-${suite.id}-${idx}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
