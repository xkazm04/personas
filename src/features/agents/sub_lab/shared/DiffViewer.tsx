import { useMemo } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { getSectionSummary, diffStrings } from './labPrimitives';
import { useTranslation } from '@/i18n/useTranslation';

interface DiffViewerProps {
  versionA: PersonaPromptVersion;
  versionB: PersonaPromptVersion;
}

export function DiffViewer({ versionA, versionB }: DiffViewerProps) {
  const { t } = useTranslation();
  const sectionsA = useMemo(() => getSectionSummary(versionA.structured_prompt), [versionA.structured_prompt]);
  const sectionsB = useMemo(() => getSectionSummary(versionB.structured_prompt), [versionB.structured_prompt]);
  const allKeys = useMemo(() => [...new Set([...Object.keys(sectionsA), ...Object.keys(sectionsB)])], [sectionsA, sectionsB]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 typo-body font-medium">
        <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 font-mono">v{versionA.version_number}</span>
        <ArrowLeftRight className="w-3.5 h-3.5 text-foreground" />
        <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 font-mono">v{versionB.version_number}</span>
      </div>

      {allKeys.map((key) => {
        const a = sectionsA[key] ?? '';
        const b = sectionsB[key] ?? '';
        if (a === b) return null;
        const diff = diffStrings(a, b);
        return (
          <div key={key} className="rounded-card border border-primary/10 bg-secondary/20 p-3">
            <h4 className="typo-body font-medium text-foreground uppercase tracking-wider mb-2">{key}</h4>
            <div className="typo-body leading-relaxed">
              {diff.map((d, i) => (
                <span
                  key={i}
                  className={
                    d.type === 'added'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : d.type === 'removed'
                        ? 'bg-red-500/20 text-red-300 line-through'
                        : 'text-foreground'
                  }
                >
                  {d.text}
                </span>
              ))}
            </div>
          </div>
        );
      })}

      {allKeys.every((key) => (sectionsA[key] ?? '') === (sectionsB[key] ?? '')) && (
        <p className="typo-body text-foreground text-center py-4">{t.agents.lab.no_structural_diff}</p>
      )}
    </div>
  );
}
