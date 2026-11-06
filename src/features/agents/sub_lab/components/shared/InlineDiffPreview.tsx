import { useMemo } from 'react';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { getSectionSummary, diffStrings } from '../../shared/labPrimitives';
import { useTranslation } from '@/i18n/useTranslation';

interface InlineDiffPreviewProps {
  older: PersonaPromptVersion;
  newer: PersonaPromptVersion;
}

interface SectionChange {
  key: string;
  type: 'added' | 'removed' | 'modified';
  addedWords: number;
  removedWords: number;
}

export function InlineDiffPreview({ older, newer }: InlineDiffPreviewProps) {
  const { t } = useTranslation();
  const changes = useMemo(() => {
    const sectionsA = getSectionSummary(older.structured_prompt);
    const sectionsB = getSectionSummary(newer.structured_prompt);
    const allKeys = [...new Set([...Object.keys(sectionsA), ...Object.keys(sectionsB)])];

    const result: SectionChange[] = [];
    for (const key of allKeys) {
      const a = sectionsA[key] ?? '';
      const b = sectionsB[key] ?? '';
      if (a === b) continue;

      if (!a) {
        result.push({ key, type: 'added', addedWords: b.split(/\s+/).length, removedWords: 0 });
      } else if (!b) {
        result.push({ key, type: 'removed', addedWords: 0, removedWords: a.split(/\s+/).length });
      } else {
        const diff = diffStrings(a, b);
        const added = diff.filter(d => d.type === 'added').reduce((n, d) => n + d.text.split(/\s+/).length, 0);
        const removed = diff.filter(d => d.type === 'removed').reduce((n, d) => n + d.text.split(/\s+/).length, 0);
        result.push({ key, type: 'modified', addedWords: added, removedWords: removed });
      }
    }
    return result;
  }, [older.structured_prompt, newer.structured_prompt]);

  if (changes.length === 0) {
    return <p className="typo-caption text-ink-2 italic">{t.agents.lab.no_prompt_changes}</p>;
  }

  return (
    <div className="space-y-1">
      {changes.map((change) => (
        <div key={change.key} className="flex items-center gap-2 typo-caption">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            change.type === 'added' ? 'bg-status-success' :
            change.type === 'removed' ? 'bg-status-error' : 'bg-status-warning'
          }`} />
          <span className="text-ink-1 font-medium capitalize">{change.key}</span>
          <span className="text-ink-1">
            {change.type === 'added' && `+${change.addedWords} words`}
            {change.type === 'removed' && `−${change.removedWords} words`}
            {change.type === 'modified' && (
              <>
                {change.addedWords > 0 && <span className="text-status-success">+{change.addedWords}</span>}
                {change.addedWords > 0 && change.removedWords > 0 && ' '}
                {change.removedWords > 0 && <span className="text-status-error">−{change.removedWords}</span>}
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
