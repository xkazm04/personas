// VARIANT — "Dossier": the case-file metaphor.
//
// Central idea: ONE surface, ZERO nested cards, and hierarchy carried entirely
// by TYPE SIZE + RULES rather than by boxes. The baseline stacks a bordered
// metadata grid inside a bordered modal and sets the claim, the evidence and
// the metadata values all around 14px/500 — so the eye has no entry point and
// every block competes. Here:
//
//   • the title is the only large type on screen;
//   • the CLAIM is the lede — one size up from everything below it, full
//     foreground, generous leading, and the first thing after the title;
//   • the evidence is body prose, muted, so it reads as support not headline;
//   • labelled hairline RULES divide sections (the only uppercase type in the
//     layout), so a section boundary is unmistakable without a border box;
//   • metadata is a definition list in a recessed footer — reference material,
//     not a feature.
//
// Colour comes from the taxonomy area (see practiceAreaTheme), so the reviewer
// reads "security practice" before reading a word.
import { Check, X, Ban, Share2, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import { KnowledgeStatusChip } from './centerShared';
import { areaTheme } from './practiceAreaTheme';
import type { PracticeViewProps } from './practiceViewTypes';

/** A hairline rule with its label sitting on it — the section marker. */
function RuleLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="typo-label text-muted-foreground uppercase tracking-wide shrink-0">
        {children}
      </span>
      <span className="h-px flex-1 bg-primary/10" />
    </div>
  );
}

/** Definition-list row. Label is the bold one; the VALUE is normal weight. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className="typo-label text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="typo-body text-foreground truncate">{children}</dd>
    </div>
  );
}

export function PracticeDetailDossier({
  practice,
  originLabel,
  actorLabel,
  busy,
  pending,
  adopted,
  onDecide,
  onRollout,
  onClose,
  nav,
}: PracticeViewProps) {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const theme = areaTheme(practice.topic);

  return (
    <div className={`flex flex-col max-h-[80vh] border-l-2 ${theme.rail}`}>
      <header className="px-6 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {practice.topic && (
                <span className={`typo-label px-1.5 py-0.5 rounded ${theme.chip}`}>
                  {practice.topic}
                </span>
              )}
              <KnowledgeStatusChip status={practice.status} />
              <span className="typo-caption text-muted-foreground">{practice.kind}</span>
              {practice.evidence_count != null && practice.evidence_count > 1 && (
                <span className="typo-caption text-muted-foreground">
                  {tx(tw.detail_evidence_count, { count: practice.evidence_count })}
                </span>
              )}
            </div>
            {/* The only large type on the surface. */}
            <h2 id="practice-detail" className="typo-title text-foreground">
              {practice.title}
            </h2>
          </div>

          {nav && nav.total > 1 && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => nav.onStep(-1)}
                disabled={busy || nav.index === 0}
                aria-label={tw.detail_prev}
                title={tw.detail_prev}
                className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="typo-caption text-muted-foreground tabular-nums whitespace-nowrap">
                {tx(tw.detail_position, { index: nav.index + 1, total: nav.total })}
              </span>
              <button
                type="button"
                onClick={() => nav.onStep(1)}
                disabled={busy || nav.index >= nav.total - 1}
                aria-label={tw.detail_next}
                title={tw.detail_next}
                className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-5 flex flex-col gap-5">
        {/* THE LEDE — one size up, full foreground, wide leading. This is the
            single sentence a reviewer must read to decide. */}
        <p className="typo-body-lg text-foreground leading-relaxed">{practice.statement}</p>

        {practice.detail_md?.trim() && (
          <section className="flex flex-col gap-2.5">
            <RuleLabel>{tw.detail_evidence}</RuleLabel>
            {/* Shared renderer, not the hand-rolled mini-markdown the baseline
                carried. Muted + relaxed so it reads as support, not headline. */}
            <MarkdownRenderer
              content={practice.detail_md}
              className="typo-body text-muted-foreground leading-relaxed"
            />
          </section>
        )}

        <section className="flex flex-col gap-2.5">
          <RuleLabel>{tw.detail_details}</RuleLabel>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 rounded-card bg-secondary/20 px-4 py-3">
            <Field label={tw.col_origin}>{originLabel}</Field>
            <Field label={tw.col_altitude}>
              {practice.abstraction ?? '—'}
              {practice.ftype ? ` · ${practice.ftype}` : ''}
            </Field>
            <Field label={tw.detail_durability}>{practice.durability ?? '—'}</Field>
            <Field label={tw.col_confidence}>
              {practice.confidence == null ? '—' : `${Math.round(practice.confidence * 100)}%`}
            </Field>
            <Field label={tw.detail_source}>{actorLabel ?? '—'}</Field>
            <Field label={tw.col_updated}>
              <RelativeTime timestamp={practice.updated_at} />
            </Field>
            {practice.decided_at && (
              <Field label={tw.detail_decided}>
                <RelativeTime timestamp={practice.decided_at} />
              </Field>
            )}
          </dl>
        </section>
      </div>

      <footer className="flex items-center gap-2 px-6 py-4 border-t border-primary/10">
        {pending && (
          <>
            <Button onClick={() => onDecide('adopt')} disabled={busy} icon={<Check className="w-4 h-4" />} className="whitespace-nowrap">
              {tw.decide_adopt}
            </Button>
            <Button variant="ghost" onClick={() => onDecide('reject')} disabled={busy} icon={<X className="w-4 h-4" />} className="whitespace-nowrap">
              {tw.decide_reject}
            </Button>
          </>
        )}
        {adopted && (
          <>
            {onRollout && (
              <Button onClick={onRollout} disabled={busy} icon={<Share2 className="w-4 h-4" />} iconRight={<ExternalLink className="w-3 h-3 opacity-60" />} className="whitespace-nowrap">
                {tw.rollout_dispatch}
              </Button>
            )}
            <Button variant="ghost" onClick={() => onDecide('deprecate')} disabled={busy} icon={<Ban className="w-4 h-4" />} className="whitespace-nowrap">
              {tw.decide_deprecate}
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {nav && nav.total > 1 && (
            <span className="typo-caption text-muted-foreground hidden md:inline whitespace-nowrap">
              {tw.detail_nav_hint}
            </span>
          )}
          <Button variant="ghost" onClick={onClose} className="whitespace-nowrap">
            {t.common.close}
          </Button>
        </div>
      </footer>
    </div>
  );
}
