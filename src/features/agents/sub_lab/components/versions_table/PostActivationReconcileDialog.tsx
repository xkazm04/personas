import { useState } from 'react';
import { Pin, Check } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { useDesignContextMutator } from '@/hooks/design/core/useDesignContextMutator';

/** One diverging use case: pins a model other than the just-promoted default. */
export interface OverrideConflict {
  useCaseId: string;
  title: string;
  /** Human label of the model the use case pins (e.g. "Haiku"). */
  pinnedLabel: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  conflicts: OverrideConflict[];
  /** Human label of the model just promoted to the persona default. */
  promotedLabel: string;
}

/**
 * Post-activation reconciliation surface. When a version is promoted, the
 * persona's default model changes — but per-use-case `model_override` pins are
 * left untouched, so a use case can silently keep executing on the old model.
 * This dialog surfaces exactly which use cases diverge and lets the user clear
 * each pin (so it follows the new default) OR keep it. Clearing writes through
 * the shared design-context mutator (no parallel write path); dismissing changes
 * nothing — "keep pin" is a first-class, no-op choice.
 */
export function PostActivationReconcileDialog({ isOpen, onClose, conflicts, promotedLabel }: Props) {
  const { t, tx } = useTranslation();
  const lab = t.agents.lab;
  const { updateSingleUseCase } = useDesignContextMutator();
  const [cleared, setCleared] = useState<Set<string>>(new Set());

  const clearPin = async (useCaseId: string) => {
    const res = await updateSingleUseCase(useCaseId, (uc) => {
      const next = { ...uc };
      delete next.model_override;
      return next;
    });
    if (res.applied) {
      setCleared((prev) => new Set(prev).add(useCaseId));
    }
  };

  const clearAll = async () => {
    for (const c of conflicts) {
      if (!cleared.has(c.useCaseId)) await clearPin(c.useCaseId);
    }
  };

  const remaining = conflicts.filter((c) => !cleared.has(c.useCaseId));

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="vr-reconcile-modal" maxWidthClass="max-w-2xl">
      <div className="p-4 space-y-3">
        <h3 className="typo-section-title text-foreground flex items-center gap-2">
          <Pin className="w-4 h-4 text-amber-300" />
          {lab.vr_reconcile_title}
        </h3>
        <p className="typo-body text-foreground/90">
          {conflicts.length === 1
            ? tx(lab.vr_reconcile_desc_one, { model: promotedLabel })
            : tx(lab.vr_reconcile_desc_other, { count: conflicts.length, model: promotedLabel })}
        </p>

        <ul className="space-y-2">
          {conflicts.map((c) => {
            const isCleared = cleared.has(c.useCaseId);
            return (
              <li
                key={c.useCaseId}
                className="flex items-center gap-3 rounded-card border border-primary/15 bg-secondary/30 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="typo-body text-foreground font-medium truncate">{c.title}</p>
                  <p className="typo-caption text-foreground/85">
                    {isCleared
                      ? tx(lab.vr_reconcile_now_follows, { model: promotedLabel })
                      : tx(lab.vr_reconcile_pinned_to, { model: c.pinnedLabel })}
                  </p>
                </div>
                {isCleared ? (
                  <span className="inline-flex items-center gap-1 typo-caption text-emerald-400">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => void clearPin(c.useCaseId)}>
                    {lab.vr_reconcile_clear_pin}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-end gap-2 pt-2">
          {remaining.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => void clearAll()}>
              {lab.vr_reconcile_clear_all}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={onClose}>
            {lab.vr_reconcile_done}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
