import { useMemo } from 'react';
import {
  parseStructuredPrompt,
  STANDARD_SECTION_KEYS,
  SECTION_LABELS,
} from '@/lib/personas/promptMigration';
import { diffStrings } from '@/features/agents/sub_lab/shared';
import { useTranslation } from '@/i18n/useTranslation';

interface Props {
  currentPromptJson: string | null;
  draftPromptJson: string | null;
  changeSummary?: string | null;
}

export function DraftDiffViewer({ currentPromptJson, draftPromptJson, changeSummary }: Props) {
  const { t } = useTranslation();
  const { diffs, hasChanges } = useMemo(() => {
    const current = currentPromptJson ? parseStructuredPrompt(currentPromptJson) : null;
    const draft = draftPromptJson ? parseStructuredPrompt(draftPromptJson) : null;

    if (!current || !draft) return { diffs: [], hasChanges: false };

    const diffs = STANDARD_SECTION_KEYS.map((key) => {
      const a = (current as unknown as Record<string, string>)[key] ?? '';
      const b = (draft as unknown as Record<string, string>)[key] ?? '';
      const changed = a !== b;
      return {
        key,
        label: SECTION_LABELS[key] ?? key,
        changed,
        diff: changed ? diffStrings(a, b) : [],
      };
    });

    return { diffs, hasChanges: diffs.some((d) => d.changed) };
  }, [currentPromptJson, draftPromptJson]);

  return (
    <div className="space-y-3">
      {changeSummary && (
        <div className="px-3 py-2 rounded-modal bg-violet-500/10 border border-violet-500/20 text-sm text-violet-300">
          {changeSummary}
        </div>
      )}

      {!hasChanges ? (
        <p className="text-sm text-muted-foreground/60 text-center py-4">{t.agents.lab.no_structural_diff}</p>
      ) : (
        diffs.map((d) => (
          <div key={d.key} className="rounded-card border border-primary/10 bg-secondary/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-sm font-medium text-muted-foreground/80 uppercase tracking-wider">{d.label}</h4>
              {!d.changed && (
                <span className="text-sm text-muted-foreground/60">{t.agents.lab.no_changes_diff}</span>
              )}
            </div>
            {d.changed && (
              <div className="text-sm leading-relaxed">
                {d.diff.map((seg, i) => (
                  <span
                    key={i}
                    className={
                      seg.type === 'added'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : seg.type === 'removed'
                          ? 'bg-red-500/20 text-red-300 line-through'
                          : 'text-foreground/70'
                    }
                  >
                    {seg.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
