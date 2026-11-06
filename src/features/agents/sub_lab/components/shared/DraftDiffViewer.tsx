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
        <div className="px-3 py-2 rounded-modal bg-role-agent/10 border border-role-agent/20 typo-body text-role-agent">
          {changeSummary}
        </div>
      )}

      {!hasChanges ? (
        <p className="typo-body text-ink-1 text-center py-4">{t.agents.lab.no_structural_diff}</p>
      ) : (
        diffs.map((d) => (
          <div key={d.key} className="rounded-card border border-hair bg-surface-1 p-3">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="typo-eyebrow text-ink-1">{d.label}</h4>
              {!d.changed && (
                <span className="typo-body text-ink-1">{t.agents.lab.no_changes_diff}</span>
              )}
            </div>
            {d.changed && (
              <div className="typo-body">
                {d.diff.map((seg, i) => (
                  <span
                    key={i}
                    className={
                      seg.type === 'added'
                        ? 'bg-status-success/20 text-status-success'
                        : seg.type === 'removed'
                          ? 'bg-status-error/20 text-status-error line-through'
                          : 'text-ink-1'
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
