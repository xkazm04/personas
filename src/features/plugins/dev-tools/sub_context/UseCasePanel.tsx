// The behavioral slice layer, rendered above the context board.
//
// A use case cuts across contexts, so the map alone cannot show it. Selecting
// one here highlights every context it spans — which is the whole point of the
// layer made visible in one interaction.
import { Check, Layers, Sparkles, Wand2, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';

import type { UseCasesState } from './useUseCases';

/** Per-kind accent, mirroring the token discipline of the context badges. */
const KIND_STYLE: Record<string, string> = {
  user_flow: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  capability: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  integration: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  ops: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
};

export default function UseCasePanel({
  state,
  selectedId,
  onSelect,
  hasMap,
}: {
  state: UseCasesState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  hasMap: boolean;
}) {
  const { t, tx } = useTranslation();
  const { active, proposed, loading, scanning, scanLine, error, backfillResult } = state;

  const kindLabel = (kind: string): string => {
    const labels = t.plugins.dev_tools;
    if (kind === 'user_flow') return labels.uc_kind_user_flow;
    if (kind === 'integration') return labels.uc_kind_integration;
    if (kind === 'ops') return labels.uc_kind_ops;
    return labels.uc_kind_capability;
  };

  const handleBackfill = () => {
    void state.backfill();
  };

  const renderChip = (uc: DevUseCase) => {
    const selected = uc.id === selectedId;
    return (
      <button
        key={uc.id}
        type="button"
        onClick={() => onSelect(selected ? null : uc.id)}
        aria-pressed={selected}
        title={uc.description ?? t.plugins.dev_tools.uc_chip_tooltip}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
          selected
            ? 'border-primary/50 bg-primary/15 text-foreground'
            : 'border-primary/10 bg-card/30 text-foreground hover:border-primary/30 hover:bg-primary/5'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            KIND_STYLE[uc.kind]?.split(' ').find((c) => c.startsWith('bg-')) ?? 'bg-primary/40'
          }`}
        />
        <span className="truncate max-w-[14rem]">{uc.name}</span>
        <span className="text-foreground tabular-nums">
          {tx(t.plugins.dev_tools.uc_span_count, { count: uc.context_ids.length })}
        </span>
      </button>
    );
  };

  return (
    <section className="mb-4 rounded-modal border border-primary/10 bg-card/20 p-3">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h3 className="typo-section-title flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-primary" />
          {t.plugins.dev_tools.uc_title}
          {active.length > 0 && (
            <span className="typo-caption text-foreground tabular-nums">({active.length})</span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          {scanning ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void state.cancelScan()}
              icon={<LoadingSpinner size="xs" />}
            >
              {t.plugins.dev_tools.uc_cancel_scan}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleBackfill}
                disabled={!hasMap || loading}
                title={t.plugins.dev_tools.uc_backfill_tooltip}
                icon={<Wand2 className="w-3 h-3" />}
              >
                {t.plugins.dev_tools.uc_backfill}
              </Button>
              <Button
                variant="accent"
                accentColor="amber"
                size="sm"
                onClick={() => void state.scan()}
                disabled={!hasMap}
                title={t.plugins.dev_tools.uc_scan_tooltip}
                icon={<Sparkles className="w-3 h-3" />}
              >
                {t.plugins.dev_tools.uc_scan}
              </Button>
            </>
          )}
        </div>
      </div>

      {scanning && scanLine && (
        <p className="typo-caption text-foreground truncate mb-2">{scanLine}</p>
      )}
      {error && <p className="typo-caption text-red-400 mb-2">{error}</p>}
      {/* Zero is the usual answer — most feature labels name a single context,
          which is a context title, not a slice. Say it plainly. */}
      {backfillResult === 0 && !scanning && (
        <p className="typo-caption text-foreground mb-2">{t.plugins.dev_tools.uc_backfill_none}</p>
      )}
      {backfillResult != null && backfillResult > 0 && !scanning && (
        <p className="typo-caption text-emerald-400 mb-2">
          {tx(t.plugins.dev_tools.uc_backfill_created, { count: backfillResult })}
        </p>
      )}

      {/* Triage queue — a narrower scope only stays useful if proposals are gated. */}
      {proposed.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-primary font-medium">
            {tx(t.plugins.dev_tools.uc_proposals_heading, { count: proposed.length })}
          </p>
          {proposed.map((uc) => (
            <div
              key={uc.id}
              className="flex items-start gap-2 rounded-modal border border-amber-500/20 bg-amber-500/5 px-2.5 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="typo-caption text-foreground font-medium truncate">{uc.name}</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                      KIND_STYLE[uc.kind] ?? KIND_STYLE.capability
                    }`}
                  >
                    {kindLabel(uc.kind)}
                  </span>
                  <span className="typo-caption text-foreground tabular-nums shrink-0">
                    {tx(t.plugins.dev_tools.uc_span_count, { count: uc.context_ids.length })}
                  </span>
                </div>
                {uc.rationale && (
                  <p className="typo-caption text-foreground mt-0.5 line-clamp-2">{uc.rationale}</p>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void state.accept(uc.id)}
                  aria-label={t.plugins.dev_tools.uc_accept}
                  title={t.plugins.dev_tools.uc_accept}
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void state.reject(uc.id)}
                  aria-label={t.plugins.dev_tools.uc_reject}
                  title={t.plugins.dev_tools.uc_reject}
                >
                  <X className="w-3.5 h-3.5 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {active.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">{active.map(renderChip)}</div>
      ) : (
        !loading &&
        proposed.length === 0 && (
          <p className="typo-caption text-foreground italic">
            {hasMap ? t.plugins.dev_tools.uc_empty : t.plugins.dev_tools.uc_empty_no_map}
          </p>
        )
      )}
      {selectedId && (
        <p className="typo-caption text-foreground mt-2">{t.plugins.dev_tools.uc_highlight_hint}</p>
      )}
    </section>
  );
}
