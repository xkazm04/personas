// The full rationale behind one simulation suggestion, in the shared modal.
//
// 2026-10-06. The rationale was rendered inline as a single `typo-caption`
// paragraph in the suggestions list - and a rationale is model-authored
// markdown, routinely several hundred characters with headings, bullets and
// inline code in it. Printed raw into a ledger row it did two things at once:
// it buried the two decisions (Apply / Dismiss) under a wall of text, and it
// showed the markdown SOURCE rather than the formatting it asks for.
//
// So the row keeps a two-line teaser and this carries the whole thing, through
// `RichMarkdown` so the headings and bullets render, with the citations listed
// rather than crammed into a tooltip. The two decisions ride along, because the
// place you finish reading the argument is the place you want to act on it.
import { Archive, Check, Cog, Target, X } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { RichMarkdown } from '@/features/shared/components/editors/RichMarkdown';
import { useTranslation } from '@/i18n/useTranslation';

import type { ActionKind, Suggestion } from './kpiSimModel';

const KIND_ICON: Record<ActionKind, typeof Cog> = {
  adopt_measure_config: Cog,
  adjust_target: Target,
  retire: Archive,
};

export function KpiSuggestionDetail({ s, title, detail, busy, onApply, onDismiss, onClose }: {
  s: Suggestion;
  /** The row's own headline, reused as this modal's title. */
  title: string;
  /** The machine detail beside the headline (a command, a target delta). */
  detail: string;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const Icon = KIND_ICON[s.kind];
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="kpi-suggestion-title"
      maxWidthClass="max-w-[44rem]"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-6 shadow-elevation-4 max-h-[85vh] overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-10 h-10 rounded-interactive bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="kpi-suggestion-title" className="typo-section-title">{title}</h2>
            {detail && <p className="typo-code mt-1 break-all">{detail}</p>}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t.common.close} onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {s.rationale && (
        // Capped measure on purpose: this is the one place on the surface that
        // is genuinely reading matter, and a 700px line beats a 1000px one.
        <div className="mt-4 rounded-card border border-primary/10 bg-card/30 px-4 py-3">
          <RichMarkdown content={s.rationale} className="typo-body max-w-[70ch]" />
        </div>
      )}

      {s.citations.length > 0 && (
        <div className="mt-4">
          <h3 className="typo-caption uppercase tracking-[0.18em] text-foreground mb-1.5">
            {tx(t.kpis.suggest_sources, { count: s.citations.length })}
          </h3>
          {/* A list, not a newline-joined tooltip. A citation is something you
              read and check, which a hover string does not allow. */}
          <ul className="space-y-1">
            {s.citations.map((c, i) => (
              <li key={`${c}-${i}`} className="flex items-start gap-2 typo-caption text-foreground">
                <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-primary/60 shrink-0" />
                <span className="min-w-0 break-words">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 pt-3 border-t border-primary/10 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
          {t.kpis.suggest_dismiss}
        </Button>
        <Button
          variant="accent"
          tone="agent"
          size="sm"
          icon={<Check className="w-3.5 h-3.5" />}
          disabled={busy}
          onClick={onApply}
          data-testid={`kpi-suggest-apply-detail-${s.kind}`}
        >
          {t.kpis.suggest_apply}
        </Button>
      </div>
    </BaseModal>
  );
}
