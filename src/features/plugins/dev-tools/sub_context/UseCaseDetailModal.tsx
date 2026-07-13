// Detail view for one use case — the metadata the review strip deliberately
// keeps out of its rows (description, rationale, the contexts it spans, where
// it came from), plus the accept / reject decision itself.
//
// Used for pending proposals today; it takes a plain DevUseCase, so it works for
// an accepted one just as well.
import { Check, X } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';

import { kindMeta, KIND_TEXT, KIND_DOT } from './contextLedgerShared';

/** 'scan' | 'backfill' | 'user' → a human label. */
function sourceLabel(createdBy: string, t: ReturnType<typeof useTranslation>['t']): string {
  const dt = t.plugins.dev_tools;
  if (createdBy === 'scan') return dt.uc_source_scan;
  if (createdBy === 'backfill') return dt.uc_source_backfill;
  return dt.uc_source_user;
}

export default function UseCaseDetailModal({
  useCase,
  contextNames,
  onClose,
  onAccept,
  onReject,
}: {
  /** The use case to show; `null` closes the modal. */
  useCase: DevUseCase | null;
  /** contextId → display name, for the spanned-context list. */
  contextNames: Map<string, string>;
  onClose: () => void;
  /** Omitted for an already-accepted use case — then the modal is read-only. */
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;

  if (!useCase) return null;

  const meta = kindMeta(useCase.kind);
  const Icon = meta.icon;
  const decidable = Boolean(onAccept && onReject);

  const decide = (fn?: (id: string) => void) => {
    fn?.(useCase.id);
    onClose();
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="use-case-detail-title" size="md">
      <div className="p-5 space-y-4">
        {/* identity */}
        <div className="flex items-start gap-3">
          <span className={`grid place-items-center w-9 h-9 rounded-card shrink-0 border border-primary/10 bg-secondary/30 ${KIND_TEXT[meta.stem]}`}>
            <Icon className="w-4.5 h-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="use-case-detail-title" className="typo-title text-foreground">
              {useCase.name}
            </h2>
            <p className="typo-caption text-foreground/70 mt-0.5">
              <span className={KIND_TEXT[meta.stem]}>{dt[meta.labelKey]}</span>
              {' · '}
              {tx(dt.uc_span_count, { count: useCase.context_ids.length })}
              {' · '}
              {dt.uc_detail_source}: {sourceLabel(useCase.created_by, t)}
            </p>
          </div>
        </div>

        {/* description */}
        <section>
          <h3 className="typo-label text-primary mb-1">{dt.uc_detail_description}</h3>
          <p className="typo-body text-foreground">
            {useCase.description?.trim() || (
              <span className="text-foreground/50 italic">{dt.uc_detail_no_description}</span>
            )}
          </p>
        </section>

        {/* why it matters — the one line the review queue is judged on */}
        {useCase.rationale?.trim() && (
          <section>
            <h3 className="typo-label text-primary mb-1">{dt.uc_detail_rationale}</h3>
            <p className="typo-body text-foreground">{useCase.rationale}</p>
          </section>
        )}

        {/* the slice */}
        <section>
          <h3 className="typo-label text-primary mb-1.5">{dt.uc_detail_contexts}</h3>
          <div className="flex flex-wrap gap-1.5">
            {useCase.context_ids.map((cid) => {
              const isPrimary = useCase.primary_context_id === cid;
              return (
                <span
                  key={cid}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 typo-caption ${
                    isPrimary
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-primary/10 bg-card/40 text-foreground'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${KIND_DOT[meta.stem]}`} />
                  {contextNames.get(cid) ?? cid}
                  {isPrimary && (
                    <span className="text-foreground/60">· {dt.uc_detail_primary}</span>
                  )}
                </span>
              );
            })}
          </div>
        </section>

        {/* decision */}
        <div className="flex items-center justify-end gap-2 pt-1">
          {decidable ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => decide(onReject)}
                icon={<X className="w-3.5 h-3.5 text-red-400" />}
              >
                {dt.uc_reject}
              </Button>
              <Button
                variant="accent"
                accentColor="emerald"
                size="sm"
                onClick={() => decide(onAccept)}
                icon={<Check className="w-3.5 h-3.5" />}
              >
                {dt.uc_accept}
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t.common.close}
            </Button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
