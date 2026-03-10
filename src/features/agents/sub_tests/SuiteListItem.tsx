import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Trash2, ChevronDown, ChevronRight,
  Pencil, X, Check, FileText,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import type { PersonaTestSuite } from '@/lib/bindings/PersonaTestSuite';
import type { TestSuiteScenario } from '@/lib/bindings/TestSuiteScenario';

interface SuiteListItemProps {
  suite: PersonaTestSuite;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onRunSuite: (suiteId: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

export function SuiteListItem({
  suite,
  isExpanded,
  onToggleExpand,
  onRunSuite,
  onDelete,
  disabled,
}: SuiteListItemProps) {
  const updateTestSuite = usePersonaStore((s) => s.updateTestSuite);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');

  let scenarios: TestSuiteScenario[] = [];
  try { scenarios = JSON.parse(suite.scenarios); } catch { /* intentional: non-critical -- JSON parse fallback */ }

  const handleStartRename = useCallback(() => {
    setIsEditing(true);
    setEditName(suite.name);
  }, [suite.name]);

  const handleSaveRename = useCallback(async () => {
    if (!editName.trim()) return;
    await updateTestSuite(suite.id, editName.trim());
    setIsEditing(false);
  }, [editName, updateTestSuite, suite.id]);

  const handleCancelRename = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleRemoveScenario = useCallback(async (scenarioIndex: number) => {
    const currentSuites = usePersonaStore.getState().testSuites;
    const currentSuite = currentSuites.find((s) => s.id === suite.id);
    if (!currentSuite) return;
    try {
      const parsed: TestSuiteScenario[] = JSON.parse(currentSuite.scenarios);
      parsed.splice(scenarioIndex, 1);
      await updateTestSuite(suite.id, undefined, undefined, JSON.stringify(parsed), parsed.length);
    } catch {
      useToastStore.getState().addToast('Failed to remove scenario from suite', 'error');
    }
  }, [updateTestSuite, suite.id]);

  return (
    <div className="border border-primary/10 rounded-xl overflow-hidden">
      {/* Suite header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-background/30 hover:bg-secondary/20 transition-colors">
        <button
          onClick={() => onToggleExpand(suite.id)}
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
            onClick={handleStartRename}
            disabled={disabled}
            className="p-1.5 rounded-lg hover:bg-secondary/30 text-muted-foreground/80 hover:text-foreground transition-colors disabled:opacity-40"
            title="Rename"
            data-testid={`suite-rename-${suite.id}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(suite.id)}
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
                            <span key={tool} className="px-1.5 py-0.5 text-sm rounded bg-primary/10 text-primary/70">
                              {tool}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveScenario(idx)}
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
}
