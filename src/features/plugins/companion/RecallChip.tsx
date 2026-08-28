import { useTranslation } from '@/i18n/useTranslation';
import type { BrainKind, CompanionRecallLane } from '@/api/companion';

/**
 * One memory chip in the recall strip, carrying WHY it is there.
 *
 * The strip has always been able to say what Athena consulted. It could not
 * say what made the cut, or on what evidence — retrieval computed a distance
 * per hit and a count of everything it rejected, then dropped both into a
 * `tracing::debug!` before the preview was built. So eleven chips read as
 * eleven matches, when six of them were query-independent floor entries that
 * would have been in the prompt no matter what was asked.
 *
 * Two visual distinctions carry that, and no more:
 * - a **relevance underline** under vector hits only, because only those have
 *   a distance. Inventing a bar for a keyword or always-on entry would make
 *   the row lie in the most plausible-looking way possible.
 * - **emphasis on what matched** (`text-primary` for vector / keyword), so
 *   "this answered what you asked" outranks "would have been here anyway".
 *   The hierarchy is built by promoting, never by fading: the repo's
 *   `no-low-contrast-text-classes` rule bans both the opacity step and the
 *   muted token, and an always-on entry is real context that should stay
 *   fully legible.
 */
export function RecallChip({
  entry,
  kind,
  onOpen,
}: {
  entry: {
    id: string;
    title: string;
    lane: CompanionRecallLane;
    relevance: number | null;
  };
  kind: BrainKind;
  onOpen?: (kind: BrainKind, id: string) => void;
}) {
  const { t } = useTranslation();
  // Same defensiveness as the floor note: an entry from a payload that predates
  // these fields has neither, and must still render as a plain chip.
  const relevance = entry.relevance ?? null;
  const laneLabel = LANE_LABELS(t)[entry.lane] ?? t.plugins.companion.recall_lane_keyword;
  // The hierarchy is built by PROMOTING what matched, not by fading what did
  // not. `no-low-contrast-text-classes` bans both the opacity step and the
  // muted token for exactly this, and its prescribed mechanism (`text-primary`
  // for emphasis, `text-foreground` for body) reads better here anyway: the
  // entries that answered the question stand out, and the always-on floor
  // stays perfectly legible instead of being greyed toward the background.
  const earned = entry.lane === 'vector' || entry.lane === 'keyword';

  const description =
    relevance === null
      ? t.plugins.companion.recall_chip_lane_aria
          .replace('{title}', entry.title)
          .replace('{lane}', laneLabel)
      : t.plugins.companion.recall_chip_relevance_aria
          .replace('{title}', entry.title)
          .replace('{lane}', laneLabel)
          .replace('{percent}', String(Math.round(relevance * 100)));

  const body = (
    <>
      <span className={earned ? 'text-primary' : 'text-foreground'}>
        {entry.title}
      </span>
      {relevance !== null && (
        // Track always rendered at full width so the fill reads as a
        // proportion of a known whole; a bare fill would look like a
        // different-sized chip rather than a different score.
        <span
          aria-hidden="true"
          className="mt-0.5 block h-0.5 w-full overflow-hidden rounded-full bg-foreground/15"
        >
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${Math.round(relevance * 100)}%` }}
          />
        </span>
      )}
    </>
  );

  const baseClass =
    'rounded-interactive bg-foreground/[0.06] border border-foreground/10 px-1.5 py-0.5';

  if (!onOpen || !entry.id) {
    return (
      <span className={baseClass} title={description} data-lane={entry.lane}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(kind, entry.id)}
      className={`${baseClass} text-left hover:bg-foreground/[0.10] hover:border-primary/30 transition-colors focus-ring cursor-pointer`}
      title={`${description} — ${t.plugins.companion.recall_open_in_brain.replace('{title}', entry.title)}`}
      aria-label={description}
      data-testid="companion-recall-chip"
      data-kind={kind}
      data-id={entry.id}
      data-lane={entry.lane}
    >
      {body}
    </button>
  );
}

/**
 * Lane → human label. Keyed off the stable wire values so a backend rename is
 * a compile error here rather than a silently unlabelled chip.
 */
function LANE_LABELS(
  t: ReturnType<typeof useTranslation>['t'],
): Record<CompanionRecallLane, string> {
  return {
    vector: t.plugins.companion.recall_lane_vector,
    keyword: t.plugins.companion.recall_lane_keyword,
    always: t.plugins.companion.recall_lane_always,
    recency: t.plugins.companion.recall_lane_recency,
  };
}
