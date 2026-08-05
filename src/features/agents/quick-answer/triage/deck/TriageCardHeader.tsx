// TriageCardHeader — the first two seconds of a card.
//
// Three jobs, in the order the eye does them: WHAT KIND of thing this is
// (chips, left), WHOSE it is (the source stamp, pinned to the card's top-right
// corner), and WHAT IT SAYS (the headline). A rule closes the block, so the
// prose below starts against an edge rather than floating under a chip row.
//
// The source stamp used to be a third line under the title, in the same
// `text-foreground` as everything else — one of the two reasons the card read
// monotone (the other was the ledger). It is meta, it belongs with the chips,
// and the corner is the one place on a card that is always empty.
//
// Hierarchy here is TYPE + TOKEN, never opacity (Design.md §"Hierarchy by type
// + color tokens"): headline `typo-heading-lg` / `text-foreground`, chips and
// stamp `typo-caption` / `typo-label` with muted labels.
import type { TriageAlert, TriageItem } from '../triageTypes';
import { Chip, KIND_META, kindCopy, TONE_BORDER, TONE_FILL, TONE_TEXT } from './DeckChips';
import type { Translations } from '@/i18n/en';

/**
 * The alert banner — the one fact that reframes the decision.
 *
 * Deliberately NOT a chip. A chip sits in a row of six other chips and reads as
 * one more label; the fact that a team step is HELD on this verdict has to be
 * the second thing the eye lands on after the headline. So: a solid tone rail
 * down the leading edge, the tone's own tint, and the consequence spelled out
 * in prose rather than implied by a colour.
 *
 * `role="status"` rather than `alert`: the card is already the focus of the
 * surface, and an assertive live region would interrupt a screen reader
 * mid-title on every deal.
 */
function AlertBanner({ alert }: { alert: TriageAlert }) {
  const Icon = alert.icon;
  return (
    <div
      role="status"
      className={`mt-3 flex items-start gap-2.5 overflow-hidden rounded-card border ${TONE_BORDER[alert.tone]} bg-secondary/25`}
    >
      <span className={`w-1 shrink-0 self-stretch ${TONE_FILL[alert.tone]}`} aria-hidden />
      <div className="min-w-0 flex-1 py-2.5 pr-3">
        <p className={`flex items-center gap-1.5 typo-label uppercase tracking-wide ${TONE_TEXT[alert.tone]}`}>
          {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
          {alert.label}
        </p>
        {alert.detail ? <p className="typo-caption mt-0.5 text-foreground">{alert.detail}</p> : null}
      </div>
    </div>
  );
}

/**
 * Whose card this is — project, persona or workspace — in the top-right corner.
 *
 * The label carries the colour dot the rest of the app uses for that entity, so
 * "which project am I in" is answered by a glance at one corner rather than by
 * finding PROJECT in a grid of six equal-weight facts.
 */
function SourceStamp({ source }: { source: TriageItem['source'] }) {
  return (
    <div className="flex min-w-0 max-w-[14rem] shrink-0 items-center gap-2 pt-0.5">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${source.color ? '' : 'bg-primary'}`}
        style={source.color ? { backgroundColor: source.color } : undefined}
        aria-hidden
      />
      <span className="min-w-0 text-right">
        <span className="typo-title block truncate text-foreground">{source.label}</span>
        {source.sublabel ? (
          <span className="typo-label block truncate uppercase tracking-wide text-muted-foreground">
            {source.sublabel}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function TriageCardHeader({ item, t }: { item: TriageItem; t: Translations }) {
  const kind = KIND_META[item.kind];
  const kindText = kindCopy(t, item.kind);

  return (
    <header className="shrink-0 border-b border-primary/10 pb-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip label={kindText.one} tone={kind.tone} icon={kind.icon} />
          {item.tags.map((tag) => (
            <Chip key={tag.id} label={tag.label} tone={tag.tone} icon={tag.icon} />
          ))}
        </div>
        <SourceStamp source={item.source} />
      </div>

      <h2 className="typo-heading-lg mt-3 max-w-[68ch] text-balance text-foreground">
        {item.title}
      </h2>

      {item.alert ? <AlertBanner alert={item.alert} /> : null}
    </header>
  );
}
