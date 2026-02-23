import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitBranch, FlaskConical,
  Shield, ArrowLeftRight, Loader2,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import {
  getPromptVersions,
  tagPromptVersion,
  rollbackPromptVersion,
} from '@/api/observability';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { VersionItem } from './prompt-lab/VersionItem';
import { DiffViewer } from './prompt-lab/DiffViewer';
import { AbTestPanel } from './prompt-lab/AbTestPanel';
import { AutoRollbackSettings } from './prompt-lab/AutoRollbackSettings';

export function PromptLabTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const [versions, setVersions] = useState<PersonaPromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'diff' | 'ab-test' | 'rollback'>('diff');

  const personaId = selectedPersona?.id;

  const fetchVersions = useCallback(async () => {
    if (!personaId) return;
    setLoading(true);
    setError(null);
    try {
      const vs = await getPromptVersions(personaId, 50);
      setVersions(vs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prompt versions');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    void fetchVersions();
  }, [fetchVersions]);

  const compareA = useMemo(
    () => versions.find((v) => v.id === compareAId) ?? null,
    [versions, compareAId],
  );

  const compareB = useMemo(
    () => versions.find((v) => v.id === compareBId) ?? null,
    [versions, compareBId],
  );

  const handleTag = async (versionId: string, tag: string) => {
    setTagging(true);
    setError(null);
    try {
      await tagPromptVersion(versionId, tag);
      await fetchVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to tag version');
    } finally {
      setTagging(false);
    }
  };

  const handleRollback = async (versionId: string) => {
    setRolling(true);
    setError(null);
    try {
      await rollbackPromptVersion(versionId);
      await fetchVersions();
      await fetchPersonas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rollback version');
    } finally {
      setRolling(false);
    }
  };

  if (!personaId) {
    return <div className="text-sm text-muted-foreground/60 text-center py-8">No persona selected</div>;
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Left: Version list */}
      <div className="w-72 flex-shrink-0 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-3 flex-shrink-0">
          <GitBranch className="w-4 h-4 text-primary/70" />
          <h3 className="text-sm font-medium text-foreground/80">Prompt Versions</h3>
          <span className="ml-auto text-xs text-muted-foreground/60">{versions.length}</span>
        </div>

        {error && (
          <div
            data-testid="prompt-lab-error"
            className="mb-2 px-3 py-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between"
          >
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              data-testid="prompt-lab-error-dismiss-btn"
              className="ml-2 text-red-400 hover:text-red-300"
            >
              &times;
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 text-muted-foreground/60 animate-spin" />
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <GitBranch className="w-8 h-8 text-muted-foreground/20 mx-auto" />
            <p className="text-sm text-muted-foreground/60">No versions yet</p>
            <p className="text-xs text-muted-foreground/40">Versions are created automatically when you edit the prompt</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {versions.map((v) => (
              <VersionItem
                key={v.id}
                version={v}
                isSelected={selectedId === v.id}
                isCompareA={compareAId === v.id}
                isCompareB={compareBId === v.id}
                onSelect={() => setSelectedId(selectedId === v.id ? null : v.id)}
                onTag={(tag) => void handleTag(v.id, tag)}
                onRollback={() => void handleRollback(v.id)}
                onSetCompareA={() => setCompareAId(compareAId === v.id ? null : v.id)}
                onSetCompareB={() => setCompareBId(compareBId === v.id ? null : v.id)}
                tagging={tagging || rolling}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right: Detail panel */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Panel tabs */}
        <div className="flex items-center gap-1 mb-3 flex-shrink-0">
          {[
            { id: 'diff' as const, label: 'Compare', icon: ArrowLeftRight },
            { id: 'ab-test' as const, label: 'A/B Test', icon: FlaskConical },
            { id: 'rollback' as const, label: 'Health', icon: Shield },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActivePanel(tab.id)}
              data-testid={`prompt-lab-tab-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activePanel === tab.id
                  ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto">
          {activePanel === 'diff' && (
            compareA && compareB ? (
              <DiffViewer versionA={compareA} versionB={compareB} />
            ) : (
              <div className="text-center py-12 space-y-2">
                <ArrowLeftRight className="w-8 h-8 text-muted-foreground/20 mx-auto" />
                <p className="text-sm text-muted-foreground/60">Select two versions to compare</p>
                <p className="text-xs text-muted-foreground/40">
                  Click the <span className="font-mono bg-blue-500/10 text-blue-400 px-1 rounded">A</span> and <span className="font-mono bg-violet-500/10 text-violet-400 px-1 rounded">B</span> buttons on any version
                </p>
              </div>
            )
          )}

          {activePanel === 'ab-test' && (
            <AbTestPanel personaId={personaId} compareA={compareA} compareB={compareB} />
          )}

          {activePanel === 'rollback' && (
            <AutoRollbackSettings personaId={personaId} />
          )}
        </div>
      </div>
    </div>
  );
}
