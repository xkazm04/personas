import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Save } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { SaveFromRunForm } from './SaveFromRunForm';
import { SuiteListItem } from './SuiteListItem';

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
  const deleteTestSuite = usePersonaStore((s) => s.deleteTestSuite);

  const [expandedSuiteId, setExpandedSuiteId] = useState<string | null>(null);
  const [savingFromRun, setSavingFromRun] = useState(false);

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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="save-suite-from-run-btn"
          >
            <Save className="w-3.5 h-3.5" />
            Save Scenarios
          </button>
        )}
      </div>

      {/* Save from run form */}
      {savingFromRun && canSave && (
        <SaveFromRunForm
          personaId={personaId}
          lastGeneratedScenarios={lastGeneratedScenarios!}
          lastRunId={lastRunId}
          onDone={() => setSavingFromRun(false)}
        />
      )}

      {/* Suite list */}
      {testSuites.length === 0 ? (
        <div className="text-center py-8 bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl">
          <div className="w-12 h-12 rounded-xl bg-primary/8 border border-primary/12 flex items-center justify-center mx-auto mb-3">
            <BookOpen className="w-6 h-6 text-primary/40" />
          </div>
          <p className="text-sm text-muted-foreground/80">No saved test suites</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            Run a test to generate scenarios, then save them here
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {testSuites.map((suite) => (
            <SuiteListItem
              key={suite.id}
              suite={suite}
              isExpanded={expandedSuiteId === suite.id}
              onToggleExpand={toggleExpand}
              onRunSuite={onRunSuite}
              onDelete={handleDelete}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
