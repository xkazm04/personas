import { useState } from 'react';
import { ConnectorIcon, getConnectorMeta } from '@/lib/connectors/connectorMeta';
import type { Translations } from '@/i18n/en';
import type { GlyphRow, GlyphDimension } from './types';
import { parseChannels, channelIcon, channelTint } from './channels';
import { prettyTriggerType, triggerDetail } from './triggers';

function EmptyNote({ label }: { label: string }) {
  return <span className="typo-label text-foreground italic">{label}</span>;
}

/** Per-dim content descriptor: the ONE place a dim's concrete content is
 *  extracted from a row. Each selector returns the content to render, or
 *  `null` when the dim is empty. `satisfies` keeps each entry's precise
 *  return type, so `DIM_CONTENT.trigger(row)` is still `GlyphTrigger[] | null`
 *  at the call site.
 *
 *  Both `isDimEmpty` and every `DimContent` branch read the row through this
 *  map — there is deliberately no second emptiness switch to keep in sync.
 *  Adding a dim means adding one entry here and one render branch below; the
 *  render branch cannot disagree with emptiness because it asks the same
 *  selector. */
const DIM_CONTENT = {
  trigger: (row: GlyphRow) => (row.triggers.length ? row.triggers : null),
  task: (row: GlyphRow) => (row.steps.length ? row.steps : null),
  connector: (row: GlyphRow) => (row.connectors.length ? row.connectors : null),
  message: (row: GlyphRow) => {
    const channels = parseChannels(row.messageSummary);
    return channels.length ? channels : null;
  },
  review: (row: GlyphRow) => row.reviewSummary || null,
  memory: (row: GlyphRow) => row.memorySummary || null,
  event: (row: GlyphRow) => (row.events.length ? row.events : null),
  error: (row: GlyphRow) => row.errorSummary || null,
} satisfies Record<GlyphDimension, (row: GlyphRow) => unknown>;

/** True when the dim has no concrete content for this row — i.e. DimContent
 *  would render only an EmptyNote. Derived from the same `DIM_CONTENT`
 *  selectors the renderer uses, so the two cannot drift apart.
 *  DimensionPanel uses this to show the dim's plain-language description as
 *  teaching content. */
export function isDimEmpty(dim: GlyphDimension, row: GlyphRow): boolean {
  // A dim outside the vocabulary has no selector and no render branch — both
  // fall through to the generic empty note, so "empty" is the right answer.
  const select: ((row: GlyphRow) => unknown) | undefined = DIM_CONTENT[dim];
  return !select || select(row) === null;
}

/** Renders the body of the DimensionPanel for a given dim. Each branch
 *  mirrors a matrix cell — label + concrete template data, trimmed to
 *  what fits comfortably in the overlay frame. */
export function DimContent({ dim, row, t }: { dim: GlyphDimension; row: GlyphRow; t: Translations }) {
  // One flag serves whichever branch renders — only one dim shows at a
  // time and the panel remounts per dim (AnimatePresence), so the
  // expansion state naturally resets when switching dimensions.
  const [showAll, setShowAll] = useState(false);
  const moreLabel = (count: number) =>
    t.templates.chronology.show_n_more.replace('{count}', String(count));

  switch (dim) {
    case 'trigger': {
      const triggers = DIM_CONTENT.trigger(row);
      if (!triggers) return <EmptyNote label={t.templates.chronology.empty_trigger} />;
      return (
        <div className="flex flex-col gap-2">
          {triggers.map((tr, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <span className="typo-body font-semibold text-foreground">{prettyTriggerType(t, tr.trigger_type)}</span>
              {triggerDetail(t, tr) && <span className="typo-label text-foreground">{triggerDetail(t, tr)}</span>}
            </div>
          ))}
        </div>
      );
    }

    case 'task': {
      const steps = DIM_CONTENT.task(row);
      if (!steps) return <EmptyNote label={t.templates.chronology.empty_steps} />;
      return (
        <ol className="flex flex-col gap-1.5 list-none">
          {(showAll ? steps : steps.slice(0, 8)).map((s, i) => (
            <li key={s.id} className="flex gap-2">
              <span className="typo-label text-foreground tabular-nums shrink-0">{i + 1}.</span>
              <div className="flex flex-col min-w-0">
                <span className="typo-body text-foreground truncate">{s.label}</span>
                {s.detail && <span className="typo-label text-foreground truncate">{s.detail}</span>}
              </div>
            </li>
          ))}
          {steps.length > 8 && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="typo-label text-foreground italic underline-offset-2 hover:underline cursor-pointer"
              >
                {showAll ? t.templates.chronology.show_less : moreLabel(steps.length - 8)}
              </button>
            </li>
          )}
        </ol>
      );
    }

    case 'connector': {
      const connectors = DIM_CONTENT.connector(row);
      if (!connectors) return <EmptyNote label={t.templates.chronology.empty_connectors} />;
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {(showAll ? connectors : connectors.slice(0, 6)).map((cn, i) => {
            const meta = getConnectorMeta(cn.name);
            return (
              <div key={i} className="flex items-center gap-2 p-1.5 rounded bg-primary/5 border border-card-border">
                <div className="w-7 h-7 rounded flex items-center justify-center shrink-0" style={{ background: `${meta?.color ?? '#60a5fa'}22` }}>
                  <ConnectorIcon meta={meta} size="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="typo-body font-semibold text-foreground truncate">{cn.label || cn.name}</span>
                  {cn.purpose && <span className="typo-label text-foreground truncate">{cn.purpose}</span>}
                </div>
              </div>
            );
          })}
          {connectors.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="flex items-center justify-center rounded border border-dashed border-card-border typo-label text-foreground hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-colors"
            >
              {showAll ? t.templates.chronology.show_less : moreLabel(connectors.length - 6)}
            </button>
          )}
        </div>
      );
    }

    case 'message': {
      const channels = DIM_CONTENT.message(row);
      if (!channels) return <EmptyNote label={t.templates.chronology.empty_channels} />;
      return (
        <div className="flex flex-col gap-1.5">
          {channels.map((ch, i) => {
            const Icon = channelIcon(ch.type);
            const tint = channelTint(ch.type);
            return (
              <div key={i} className="flex items-center gap-2 p-1.5 rounded bg-primary/5 border border-card-border">
                <div className="w-7 h-7 rounded flex items-center justify-center shrink-0" style={{ background: `${tint}22` }}>
                  <Icon className="w-4 h-4" style={{ color: tint }} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="typo-body font-semibold text-foreground capitalize">{ch.type}</span>
                  {ch.description && <span className="typo-label text-foreground truncate">{ch.description}</span>}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    case 'review': {
      const review = DIM_CONTENT.review(row);
      return review
        ? <p className="typo-body text-foreground leading-relaxed">{review}</p>
        : <EmptyNote label={t.templates.chronology.empty_review} />;
    }

    case 'memory': {
      const memory = DIM_CONTENT.memory(row);
      return memory
        ? <p className="typo-body text-foreground leading-relaxed">{memory}</p>
        : <EmptyNote label={t.templates.chronology.empty_memory} />;
    }

    case 'event': {
      const events = DIM_CONTENT.event(row);
      if (!events) return <EmptyNote label={t.templates.chronology.empty_events} />;
      return (
        <div className="flex flex-col gap-1.5">
          {events.map((e, i) => (
            <div key={i} className="flex flex-col gap-0.5 p-1.5 rounded bg-primary/5 border border-card-border">
              <span className="typo-body font-semibold text-foreground">{e.event_type}</span>
              {e.description && <span className="typo-label text-foreground">{e.description}</span>}
            </div>
          ))}
        </div>
      );
    }

    case 'error': {
      const error = DIM_CONTENT.error(row);
      return error
        ? <p className="typo-body text-foreground leading-relaxed">{error}</p>
        : <EmptyNote label={t.templates.chronology.empty_error} />;
    }

    default:
      return <EmptyNote label={t.templates.chronology.empty_generic} />;
  }
}
