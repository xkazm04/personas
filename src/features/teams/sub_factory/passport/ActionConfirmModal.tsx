// The consent gate, redesigned (2026-07-28). It used to be a 296px popover with
// one paragraph — enough to say WHAT an action is called, not enough to decide
// whether to run it. This is the same gate at reading size: the action's impact
// class up front, an at-a-glance fact strip, the ORDERED steps the click sets
// off, and the boundaries that hold regardless. Content lives in
// actionConfirmCatalog so the copy stays next to the flows it describes.
import { Check, ShieldCheck } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';

import { IMPACT_META, type ActionSpec } from './actionConfirmCatalog';

const TITLE_ID = 'passport-action-confirm-title';

export function ActionConfirmModal({ spec, onConfirm, onClose, extra, confirmDisabled }: {
  spec: ActionSpec;
  onConfirm: () => void;
  onClose: () => void;
  /** Controls that change what confirming actually does (the populate action's
   *  lane picker is the first). Actions without a choice to make pass nothing. */
  extra?: React.ReactNode;
  /** Block confirmation while `extra`'s choice is incomplete — e.g. a scope
   *  with every lane unticked, where confirming would run nothing. */
  confirmDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = spec.icon;
  const impact = IMPACT_META[spec.impact];

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} portal maxWidthClass="max-w-3xl" staggerChildren={false}>
      {/* flex column so a long action (onboard: 5 steps + 4 boundaries) scrolls
          its body instead of being clipped by the panel's max-h-[85vh] */}
      <div className="flex flex-col max-h-[78vh] min-h-0" data-testid="passport-action-confirm">
        {/* identity — icon tile, title, impact class */}
        <div className="flex items-start gap-3 min-w-0 shrink-0">
          <span
            className="inline-flex items-center justify-center w-11 h-11 rounded-card shrink-0"
            style={{ background: `${impact.hue}1a`, border: `1px solid ${impact.hue}44` }}
          >
            <Icon className="w-6 h-6" style={{ color: impact.hue }} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={TITLE_ID} className="typo-title-lg">{spec.title}</h2>
            <span
              className="mt-1 inline-flex items-center gap-1.5 rounded-input px-2 py-0.5 typo-caption font-medium"
              style={{ color: impact.hue, background: `${impact.hue}14`, border: `1px solid ${impact.hue}3d` }}
              data-testid="passport-action-impact"
            >
              <ShieldCheck className="w-4 h-4" aria-hidden />
              {impact.label}
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <p className="typo-body-lg text-foreground mt-3">{spec.summary}</p>

          {/* at-a-glance facts */}
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {spec.facts.map((f) => (
              <div
                key={f.label}
                className="rounded-card px-2.5 py-1.5 min-w-0"
                style={{ background: 'rgba(148,163,184,.05)', border: '1px solid rgba(148,163,184,.12)' }}
              >
                <dt className="typo-caption uppercase tracking-[0.08em] text-foreground/45 truncate">{f.label}</dt>
                <dd className="typo-body-lg font-medium text-foreground truncate" title={f.value}>{f.value}</dd>
              </div>
            ))}
          </dl>

          {/* Optional per-action controls that change what confirming DOES —
              rendered above "What happens" because the steps below describe
              the choice made here. */}
          {extra ? <div className="mt-4">{extra}</div> : null}

          <div className="mt-4 grid md:grid-cols-2 gap-4">
            {/* what happens, in order */}
            <section className="min-w-0">
              <h3 className="typo-caption uppercase tracking-[0.08em] text-foreground/45 mb-2">What happens</h3>
              <ol className="space-y-2">
                {spec.steps.map((step, i) => (
                  <li key={step} className="flex items-start gap-2.5 min-w-0">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 typo-caption font-semibold tabular-nums mt-px"
                      style={{ background: `${impact.hue}1a`, color: impact.hue, border: `1px solid ${impact.hue}3d` }}
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    <span className="typo-body-lg text-foreground min-w-0">{step}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* what holds regardless */}
            <section className="min-w-0">
              <h3 className="typo-caption uppercase tracking-[0.08em] text-foreground/45 mb-2">What it will not do</h3>
              <ul className="space-y-2">
                {spec.boundaries.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 min-w-0">
                    <Check className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#34D399' }} aria-hidden />
                    <span className="typo-body-lg text-foreground min-w-0">{b}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-primary/10 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-interactive typo-body-lg font-medium text-foreground hover:bg-secondary/40 border border-primary/10 transition-colors focus-ring"
            data-testid="passport-action-confirm-cancel"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={() => { onClose(); onConfirm(); }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-interactive typo-body-lg font-semibold transition-colors focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: impact.hue, background: `${impact.hue}22`, border: `1px solid ${impact.hue}55` }}
            data-testid="passport-action-confirm-yes"
          >
            <Icon className="w-5 h-5" aria-hidden />
            {spec.confirmLabel}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
