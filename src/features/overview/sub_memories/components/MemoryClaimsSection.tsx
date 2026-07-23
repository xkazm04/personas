// Dispute claims on a single memory (Brainiac-adoption P3) — the human half of
// the claims loop. Filing `wrong`/`outdated` demotes the memory in recall
// (bounded penalty) and raises a `memory_disputed` finding; the claims stay
// OPEN until someone answers here: reverify (claims were mistaken), deprecate
// (archive the memory — the sanctioned retire), or dismiss. `helpful` filing
// is deliberately absent from this surface: injections already carry the
// access signal, and a thumbs-up button would just farm noise.
import { useCallback, useEffect, useState } from 'react';
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
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

const VERDICT_TW: Record<string, string> = {
  wrong: 'bg-red-500/10 text-red-300 border-red-500/25',
  outdated: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  helpful: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
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
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    listMemoryClaims(memoryId).then(setClaims).catch(toastCatch('MemoryClaimsSection:list'));
  }, [memoryId]);
  useEffect(() => { reload(); }, [reload]);

  const open = claims.filter((c) => c.resolution === null && c.verdict !== 'helpful');

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
        <div className="typo-code font-mono text-foreground uppercase tracking-wider">{md.claims_label}</div>
        {open.length > 0 && (
          <span className="px-1.5 py-0.5 typo-label rounded border bg-red-500/10 text-red-300 border-red-500/25">
            {tx(md.claims_open_badge, { count: open.length })}
          </span>
        )}
      </div>

      {claims.length === 0 && (
        <p className="typo-caption text-foreground mb-2">{md.claims_empty}</p>
      )}

      {claims.length > 0 && (
        <ul className="space-y-1 mb-2">
          {claims.map((c) => (
            <li key={c.id} className="flex items-start gap-2 typo-caption">
              <span className={`px-1.5 py-0.5 typo-label rounded border flex-shrink-0 ${VERDICT_TW[c.verdict] ?? ''}`}>
                {verdictLabel(c.verdict)}
              </span>
              <span className="min-w-0 flex-1 text-foreground">
                {c.note && <span className="block truncate" title={c.note}>{c.note}</span>}
                <span className="typo-label text-foreground inline-flex items-center gap-1">
                  <RelativeTime timestamp={c.created_at} className="tabular-nums" />
                  {c.resolution && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-300/80">
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
          className="flex-1 min-w-[180px] px-2 py-1 typo-caption rounded-input bg-secondary/30 border border-primary/15 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => file('wrong')}
          className="inline-flex items-center gap-1 px-2 py-1 typo-caption rounded-card border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          <Flag className="w-3 h-3" aria-hidden /> {md.claim_wrong}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => file('outdated')}
          className="inline-flex items-center gap-1 px-2 py-1 typo-caption rounded-card border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
        >
          <Flag className="w-3 h-3" aria-hidden /> {md.claim_outdated}
        </button>
      </div>

      {/* resolve everything open with one decision */}
      {open.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <ShieldQuestion className="w-3.5 h-3.5 text-foreground flex-shrink-0" aria-hidden />
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve('reverified')}
            className="px-2 py-1 typo-caption rounded-card border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            {md.claim_resolve_reverify}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve('deprecated')}
            className="px-2 py-1 typo-caption rounded-card border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            {md.claim_resolve_deprecate}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve('dismissed')}
            className="px-2 py-1 typo-caption rounded-card border border-primary/15 bg-secondary/30 text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
          >
            {md.claim_resolve_dismiss}
          </button>
        </div>
      )}
    </div>
  );
}
