import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { diffNoteLines } from './conflictDiff';

/** Cap each side before diffing so the O(n·m) LCS stays cheap on huge notes. */
const MAX_CHARS = 6000;

const ROW = 'flex gap-2 px-2.5 py-0.5 whitespace-pre-wrap break-words';
const MARK = 'select-none flex-shrink-0 w-3 text-center';

/**
 * Unified, line-level diff of the two sides of a sync conflict. Lines unique
 * to the app version read with a blue `−` accent, lines unique to the vault
 * with a violet `+`, shared lines as plain context — so the user can see
 * exactly what diverged before choosing keep-app / keep-vault.
 */
export default function ConflictDiffView({
  appContent,
  vaultContent,
}: {
  appContent: string;
  vaultContent: string;
}) {
  const { t } = useTranslation();
  const ob = t.plugins.obsidian_brain;

  const { lines, truncated } = useMemo(() => {
    const aTrunc = appContent.length > MAX_CHARS;
    const bTrunc = vaultContent.length > MAX_CHARS;
    return {
      lines: diffNoteLines(
        aTrunc ? appContent.slice(0, MAX_CHARS) : appContent,
        bTrunc ? vaultContent.slice(0, MAX_CHARS) : vaultContent,
      ),
      truncated: aTrunc || bTrunc,
    };
  }, [appContent, vaultContent]);

  return (
    <div className="space-y-2">
      {/* Legend */}
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 typo-caption text-blue-400/80">
          <span className="w-2 h-2 rounded-interactive bg-blue-400/70" />
          {ob.app_version}
        </span>
        <span className="inline-flex items-center gap-1.5 typo-caption text-violet-400/80">
          <span className="w-2 h-2 rounded-interactive bg-violet-400/70" />
          {ob.vault_version}
        </span>
      </div>

      <div className="rounded-card bg-secondary/30 border border-primary/10 max-h-64 overflow-y-auto font-mono typo-caption">
        {lines.map((line, idx) => {
          if (line.kind === 'app') {
            return (
              <div key={idx} className={`${ROW} bg-blue-500/10`}>
                <span className={`${MARK} text-blue-400`}>−</span>
                <span className="text-foreground min-w-0">{line.text || ' '}</span>
              </div>
            );
          }
          if (line.kind === 'vault') {
            return (
              <div key={idx} className={`${ROW} bg-violet-500/10`}>
                <span className={`${MARK} text-violet-400`}>+</span>
                <span className="text-foreground min-w-0">{line.text || ' '}</span>
              </div>
            );
          }
          return (
            <div key={idx} className={ROW}>
              <span className={MARK}> </span>
              <span className="text-foreground min-w-0">{line.text || ' '}</span>
            </div>
          );
        })}
      </div>

      {truncated && <p className="typo-caption text-foreground">{ob.diff_truncated}</p>}
    </div>
  );
}
