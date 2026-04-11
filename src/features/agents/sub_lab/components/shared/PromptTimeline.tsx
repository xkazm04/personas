import { useEffect, useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { GitBranch, RefreshCw } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { TimelineEntry } from './TimelineEntry';

export function PromptTimeline() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const promptVersions = useAgentStore((s) => s.promptVersions);
  const fetchVersions = useAgentStore((s) => s.fetchVersions);
  const tagVersion = useAgentStore((s) => s.tagVersion);
  const rollbackVersion = useAgentStore((s) => s.rollbackVersion);
  const baselinePin = useAgentStore((s) => s.baselinePin);
  const loadBaseline = useAgentStore((s) => s.loadBaseline);

  const [loading, setLoading] = useState(true);
  const personaId = selectedPersona?.id;

  useEffect(() => {
    if (personaId) {
      setLoading(true);
      fetchVersions(personaId).finally(() => setLoading(false));
      loadBaseline(personaId);
    }
  }, [personaId, fetchVersions, loadBaseline]);

  const handleTag = useCallback(async (versionId: string, tag: string) => {
    await tagVersion(versionId, tag);
  }, [tagVersion]);

  const handleRollback = useCallback(async (versionId: string) => {
    await rollbackVersion(versionId);
  }, [rollbackVersion]);

  const handleRefresh = useCallback(() => {
    if (personaId) {
      setLoading(true);
      fetchVersions(personaId).finally(() => setLoading(false));
    }
  }, [personaId, fetchVersions]);

  // Sort versions newest-first for the timeline
  const sortedVersions = [...promptVersions].sort((a, b) => b.version_number - a.version_number);

  // Build a map of version_number -> version for looking up previous versions
  const versionByNumber = new Map<number, PersonaPromptVersion>();
  for (const v of promptVersions) versionByNumber.set(v.version_number, v);

  if (loading && promptVersions.length === 0) {
    return <ContentLoader variant="panel" hint="versions" />;
  }

  if (sortedVersions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <GitBranch className="w-8 h-8 text-muted-foreground/15" />
        <p className="text-sm font-medium text-muted-foreground/50">No prompt versions yet</p>
        <p className="text-xs text-muted-foreground/35 max-w-xs text-center">
          Versions are created automatically when the prompt is modified through the Lab or Matrix build.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="prompt-timeline">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-foreground/70">Prompt Timeline</h3>
          <span className="text-[10px] text-muted-foreground/40 px-1.5 py-0.5 rounded-md bg-secondary/30">
            {sortedVersions.length} version{sortedVersions.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-primary/5 transition-colors disabled:opacity-40"
          title="Refresh versions"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {sortedVersions.map((version, index) => {
          const previousVersion = versionByNumber.get(version.version_number - 1) ?? null;
          return (
            <motion.div
              key={version.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05, duration: 0.25 }}
            >
              <TimelineEntry
                version={version}
                previousVersion={previousVersion}
                isFirst={index === 0}
                isLast={index === sortedVersions.length - 1}
                isBaseline={baselinePin?.versionId === version.id}
                onTag={handleTag}
                onRollback={handleRollback}
              />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
