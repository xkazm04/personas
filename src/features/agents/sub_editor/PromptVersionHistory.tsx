import { useEffect, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Clock, FileText } from 'lucide-react';
import type { PersonaPromptVersion } from '@/lib/types/types';

interface PromptVersionHistoryProps {
  personaId: string;
}

function computeDelta(current: PersonaPromptVersion, previous: PersonaPromptVersion): string | null {
  const curLen = current.system_prompt?.length ?? 0;
  const prevLen = previous.system_prompt?.length ?? 0;
  if (curLen === 0 && prevLen === 0) return null;
  const added = Math.max(0, curLen - prevLen);
  const removed = Math.max(0, prevLen - curLen);
  if (added === 0 && removed === 0) return null;
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`-${removed}`);
  return `${parts.join(' / ')} chars`;
}

export default function PromptVersionHistory({ personaId }: PromptVersionHistoryProps) {
  const fetchPromptVersions = usePersonaStore((s) => s.fetchPromptVersions);
  const promptVersions = usePersonaStore((s) => s.promptVersions);

  useEffect(() => {
    fetchPromptVersions(personaId);
  }, [personaId, fetchPromptVersions]);

  // Build a map of version deltas for versions without change_summary
  const deltaMap = useMemo(() => {
    const map = new Map<string, string>();
    for (let i = 0; i < promptVersions.length; i++) {
      const version = promptVersions[i]!;
      if (!version.change_summary && i < promptVersions.length - 1) {
        const previous = promptVersions[i + 1]!;
        const delta = computeDelta(version, previous);
        if (delta) map.set(version.id, delta);
      }
    }
    return map;
  }, [promptVersions]);

  if (promptVersions.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground/80">
        No prompt versions recorded yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
        <Clock className="w-4 h-4" />
        Prompt Version History
      </h3>
      <div className="relative pl-5">
        {/* Timeline connector line */}
        <div className="absolute left-[5px] top-2 bottom-2 w-[2px] bg-primary/10" />

        <div className="space-y-2">
          {promptVersions.map((version: PersonaPromptVersion, index: number) => {
            const isLatest = index === 0;
            const delta = deltaMap.get(version.id);

            return (
              <div key={version.id} className="relative">
                {/* Timeline dot */}
                <div
                  className={`absolute -left-5 top-3.5 w-[10px] h-[10px] rounded-full border-2 ${
                    isLatest
                      ? 'bg-primary border-primary/50'
                      : 'bg-secondary border-primary/20'
                  }`}
                />

                <div className="bg-secondary/30 border border-primary/15 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-primary/70">v{version.version_number}</span>
                      {isLatest && (
                        <span className="px-1.5 py-0.5 text-sm font-medium rounded bg-primary/15 text-primary/70 border border-primary/20">
                          latest
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground/80">
                      {new Date(version.created_at).toLocaleDateString()} {new Date(version.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {version.change_summary && (
                    <p className="text-sm text-muted-foreground/80 mb-2">{version.change_summary}</p>
                  )}
                  {!version.change_summary && delta && (
                    <p className="text-sm text-muted-foreground/80 mb-2 font-mono">{delta}</p>
                  )}
                  {version.system_prompt && (
                    <details className="group">
                      <summary className="cursor-pointer text-sm text-muted-foreground/90 hover:text-foreground/95 flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        View prompt
                      </summary>
                      <pre className="mt-2 p-2 bg-background/50 rounded text-sm text-muted-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {version.system_prompt?.slice(0, 1000)}
                        {(version.system_prompt?.length || 0) > 1000 ? '...' : ''}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
