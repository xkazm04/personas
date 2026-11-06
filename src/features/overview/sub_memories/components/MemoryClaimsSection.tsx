// Dispute claims on a single memory (Brainiac-adoption P3) — the human half of
// the claims loop. Filing `wrong`/`outdated` demotes the memory in recall
// (bounded penalty) and raises a `memory_disputed` finding; the claims stay
// OPEN until someone answers here: reverify (claims were mistaken), deprecate
// (archive the memory — the sanctioned retire), or dismiss. `helpful` filing
// is deliberately absent from this surface: injections already carry the
// access signal, and a thumbs-up button would just farm noise.
import { useCallback, useEffect, useRef, useState } from 'react';
import { StateMark, type StateMarkState } from '@/features/shared/components/display/StateMark';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import Button from '@/features/shared/components/buttons/Button';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { CheckCircle2, Flag, ShieldQuestion } from 'lucide-react';

import {
  fileMemoryClaim,
  listMemoryClaims,
  resolveMemoryClaims,
  type ClaimResolution,
  type ClaimVerdict,
  type MemoryClaim,
} from '@/api/overview/memories';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { createLatestWins } from '@/stores/util/latestWins';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

const VERDICT_STATE: Record<string, StateMarkState> = {
  wrong: 'error',
  outdated: 'warning',
  helpful: 'success',
};

export function MemoryClaimsSection({ memoryId, onResolved }: {
  memoryId: string;
  /** Fired after a resolution lands so the parent can refresh its list
   *  (deprecate archives the memory out of most views). */
  onResolved?: (resolution: ClaimResolution) => void;
}) {
  const { t, tx } = useTranslation();
  const md = t.overview.memory_detail;
  const addToast = useToastStore((s) => s.addToast);
  const [claims, setClaims] = useState<MemoryClaim[]>([]);
  // Which memory `claims` was READ for. Until a read for the current memory
  // succeeds there is no list to show: not "no disputes" (a failed or pending
  // read), and not the previous memory's claims (whose open set would drive
  // the deprecate button for THIS memory).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Latest-wins guard for the claims fetch — the shared primitive, not a
  // hand-rolled counter. `reload()` fires on every `memoryId` change and after
  // every file/resolve, so two responses are routinely in flight at once: open
  // memory A, switch quickly to B, and if A's response lands second it wrote
  // A's claims into B's panel. That is not cosmetic here — the panel's
  // `deprecate` button archives the memory the panel is CURRENTLY bound to, so
  // a mismatched claim list invites a destructive action on the wrong evidence.
  // The same token also makes a post-unmount write inert.
  const latest = useRef(createLatestWins()).current;
  const reload = useCallback(() => {
    const token = latest.next();
    listMemoryClaims(memoryId)
      .then((rows) => {
        if (!latest.isCurrent(token)) return;
        setClaims(rows);
        setLoadedFor(memoryId);
      })
      .catch(toastCatch('MemoryClaimsSection:list'));
  }, [memoryId, latest]);
  useEffect(() => {
    reload();
    // Retire the in-flight token on unmount / memoryId change so a response
    // that lands afterwards can never call setClaims on a dead component.
    return () => { latest.next(); };
  }, [reload, latest]);

  const shown = loadedFor === memoryId ? claims : [];
  const open = shown.filter((c) => c.resolution === null && c.verdict !== 'helpful');

  const file = async (verdict: ClaimVerdict) => {
    setBusy(true);
    try {
      await fileMemoryClaim(memoryId, verdict, note.trim() || undefined);
      setNote('');
      addToast(md.claim_filed_toast, 'success');
      reload();
    } catch (e) {
      toastCatch('MemoryClaimsSection:file', md.claim_error_toast)(e);
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (resolution: ClaimResolution) => {
    setBusy(true);
    try {
      await resolveMemoryClaims(memoryId, resolution);
      addToast(md.claim_resolved_toast, 'success');
      reload();
      onResolved?.(resolution);
    } catch (e) {
      toastCatch('MemoryClaimsSection:resolve', md.claim_error_toast)(e);
    } finally {
      setBusy(false);
    }
  };

  const verdictLabel = (v: string) =>
    v === 'wrong' ? md.claim_verdict_wrong : v === 'outdated' ? md.claim_verdict_outdated : md.claim_verdict_helpful;
  const resolutionLabel = (r: string) =>
    r === 'reverified' ? md.claim_resolution_reverified
    : r === 'deprecated' ? md.claim_resolution_deprecated
    : md.claim_resolution_dismissed;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="typo-eyebrow">{md.claims_label}</div>
        {open.length > 0 && (
          <StateMark state="error" label={tx(md.claims_open_badge, { count: open.length })} />
        )}
      </div>

      {loadedFor === memoryId && claims.length === 0 && (
        <div className="mb-2 flex justify-center">
          <ScenarioEmptyState art="report" size="sm" title={md.claims_empty} />
        </div>
      )}

      {shown.length > 0 && (
        <ul className="space-y-1 mb-2">
          {shown.map((c) => (
            <li key={c.id} className="flex items-start gap-2 typo-caption">
              <StateMark className="flex-shrink-0" state={VERDICT_STATE[c.verdict] ?? 'neutral'} label={verdictLabel(c.verdict)} />
              <span className="min-w-0 flex-1 text-foreground">
                {c.note && <Tooltip content={c.note}><span className="block truncate">{c.note}</span></Tooltip>}
                <span className="typo-label text-ink-2 inline-flex items-center gap-1">
                  <RelativeTime timestamp={c.created_at} className="num" />
                  {c.resolution && (
                    <span className="inline-flex items-center gap-0.5 text-status-success">
                      <CheckCircle2 className="w-3 h-3" aria-hidden /> {resolutionLabel(c.resolution)}
                    </span>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* file a dispute */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={md.claim_note_placeholder}
          className="flex-1 min-w-[180px] px-2 py-1 typo-caption rounded-input bg-surface-1 border border-hair text-foreground placeholder:text-ink-3 focus:outline-none focus:border-primary/40"
        />
        <Button variant="danger" size="sm" disabled={busy} onClick={() => file('wrong')} icon={<Flag className="w-3 h-3" aria-hidden />}>
{md.claim_wrong}
</Button>
        <Button variant="accent" tone="warning" size="sm" disabled={busy} onClick={() => file('outdated')} icon={<Flag className="w-3 h-3" aria-hidden />}>
{md.claim_outdated}
</Button>
      </div>

      {/* resolve everything open with one decision */}
      {open.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <ShieldQuestion className="w-3.5 h-3.5 text-foreground flex-shrink-0" aria-hidden />
          <Button variant="accent" tone="success" size="sm" disabled={busy} onClick={() => resolve('reverified')}>
            {md.claim_resolve_reverify}
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => resolve('deprecated')}>
            {md.claim_resolve_deprecate}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => resolve('dismissed')}>
            {md.claim_resolve_dismiss}
          </Button>
        </div>
      )}
    </div>
  );
}
