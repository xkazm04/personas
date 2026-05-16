/**
 * PromptDiffModal — side-by-side prompt comparison between two competition
 * slots. Pure frontend: line-level LCS diff that highlights added/removed/
 * matched lines with no new deps. Useful for understanding WHY one strategy
 * won — the WinnerInsightDialog records the author's hypothesis; this
 * surfaces the actual delta in the prompt that produced the difference.
 */
import { useMemo } from 'react';
import { Trophy, AlertCircle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevCompetitionSlot } from '@/lib/bindings/DevCompetitionSlot';

interface SlotPair {
  slot: DevCompetitionSlot;
  isWinner?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  left: SlotPair | null;
  right: SlotPair | null;
}

type DiffOp = 'same' | 'add' | 'remove';
interface DiffLine {
  leftText: string | null;
  rightText: string | null;
  op: DiffOp;
}

// Line-level LCS — small enough for prompts (typically <100 lines).
function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const m = aLines.length;
  const n = bLines.length;
  // dp[i][j] = LCS length of aLines[i..] vs bLines[j..]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  // Backtrack to build the diff in display order
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      out.push({ leftText: aLines[i]!, rightText: bLines[j]!, op: 'same' });
      i++; j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ leftText: aLines[i]!, rightText: null, op: 'remove' });
      i++;
    } else {
      out.push({ leftText: null, rightText: bLines[j]!, op: 'add' });
      j++;
    }
  }
  while (i < m) { out.push({ leftText: aLines[i]!, rightText: null, op: 'remove' }); i++; }
  while (j < n) { out.push({ leftText: null, rightText: bLines[j]!, op: 'add' }); j++; }
  return out;
}

export function PromptDiffModal({ open, onClose, left, right }: Props) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;

  const lines = useMemo(() => {
    if (!left || !right) return [];
    return diffLines(left.slot.strategy_prompt ?? '', right.slot.strategy_prompt ?? '');
  }, [left, right]);

  const stats = useMemo(() => {
    let same = 0, add = 0, remove = 0;
    for (const l of lines) {
      if (l.op === 'same') same++;
      else if (l.op === 'add') add++;
      else remove++;
    }
    return { same, add, remove };
  }, [lines]);

  if (!left || !right) return null;

  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="prompt-diff-title" size="xl">
      <div className="p-5 border-b border-primary/10">
        <h3 id="prompt-diff-title" className="typo-section-title mb-1">{dl.prompt_diff_title}</h3>
        <p className="typo-caption text-foreground/70">
          {tx(dl.prompt_diff_stats, { same: stats.same, added: stats.add, removed: stats.remove })}
        </p>
      </div>

      <div className="grid grid-cols-2 max-h-[60vh] overflow-y-auto">
        {/* Left header */}
        <div className="px-4 py-2.5 border-b border-primary/10 bg-primary/5 sticky top-0 z-10 flex items-center gap-2">
          {left.isWinner && <Trophy className="w-3.5 h-3.5 text-amber-400" />}
          <span className="typo-caption font-medium text-foreground truncate">{left.slot.strategy_label}</span>
          {left.slot.disqualified && (
            <span className="typo-caption text-red-400 flex items-center gap-1 ml-auto"><AlertCircle className="w-3 h-3" />DQ</span>
          )}
        </div>
        {/* Right header */}
        <div className="px-4 py-2.5 border-b border-primary/10 border-l border-l-primary/10 bg-primary/5 sticky top-0 z-10 flex items-center gap-2">
          {right.isWinner && <Trophy className="w-3.5 h-3.5 text-amber-400" />}
          <span className="typo-caption font-medium text-foreground truncate">{right.slot.strategy_label}</span>
          {right.slot.disqualified && (
            <span className="typo-caption text-red-400 flex items-center gap-1 ml-auto"><AlertCircle className="w-3 h-3" />DQ</span>
          )}
        </div>

        {/* Diff body — render each diff line as a 2-cell grid row */}
        {lines.length === 0 ? (
          <div className="col-span-2 p-8 text-center text-foreground/60 typo-body">{dl.prompt_diff_empty}</div>
        ) : (
          lines.map((line, idx) => {
            const leftCls = line.op === 'same' ? 'bg-transparent' : line.op === 'remove' ? 'bg-red-500/10' : 'bg-foreground/[0.02]';
            const rightCls = line.op === 'same' ? 'bg-transparent' : line.op === 'add' ? 'bg-emerald-500/10' : 'bg-foreground/[0.02]';
            return (
              <DiffRow key={idx} leftText={line.leftText} rightText={line.rightText} leftCls={leftCls} rightCls={rightCls} />
            );
          })
        )}
      </div>

      <div className="p-4 border-t border-primary/10 flex items-center justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>{t.common.close}</Button>
      </div>
    </BaseModal>
  );
}

function DiffRow({
  leftText, rightText, leftCls, rightCls,
}: {
  leftText: string | null;
  rightText: string | null;
  leftCls: string;
  rightCls: string;
}) {
  return (
    <>
      <pre className={`px-4 py-1 text-xs font-mono whitespace-pre-wrap break-words text-foreground ${leftCls}`}>
        {leftText ?? ' '}
      </pre>
      <pre className={`px-4 py-1 text-xs font-mono whitespace-pre-wrap break-words text-foreground border-l border-primary/10 ${rightCls}`}>
        {rightText ?? ' '}
      </pre>
    </>
  );
}
