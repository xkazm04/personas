import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import type { Translations } from '@/i18n/en';
import type { GlyphRow, GlyphDimension } from './types';
import { parseChannels, channelIcon, channelTint } from './channels';
import { prettyTriggerType, triggerDetail } from './triggers';

function EmptyNote({ label }: { label: string }) {
  return <span className="typo-label text-foreground/50 italic">{label}</span>;
}

/** Renders the body of the DimensionPanel for a given dim. Each branch
 *  mirrors a matrix cell — label + concrete template data, trimmed to
 *  what fits comfortably in the overlay frame. */
export function DimContent({ dim, row, t }: { dim: GlyphDimension; row: GlyphRow; t: Translations }) {
  switch (dim) {
    case 'trigger':
      if (!row.triggers.length) return <EmptyNote label="No trigger configured" />;
      return (
        <div className="flex flex-col gap-2">
          {row.triggers.map((tr, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <span className="typo-body font-semibold text-foreground">{prettyTriggerType(t, tr.trigger_type)}</span>
              {triggerDetail(tr) && <span className="typo-label text-foreground/70">{triggerDetail(tr)}</span>}
            </div>
          ))}
        </div>
      );

    case 'task':
      if (!row.steps.length) return <EmptyNote label="No steps defined" />;
      return (
        <ol className="flex flex-col gap-1.5 list-none">
          {row.steps.slice(0, 8).map((s, i) => (
            <li key={s.id} className="flex gap-2">
              <span className="typo-label text-foreground/50 tabular-nums shrink-0">{i + 1}.</span>
              <div className="flex flex-col min-w-0">
                <span className="typo-body text-foreground truncate">{s.label}</span>
                {s.detail && <span className="typo-label text-foreground/60 truncate">{s.detail}</span>}
              </div>
            </li>
          ))}
          {row.steps.length > 8 && <li className="typo-label text-foreground/50 italic">+{row.steps.length - 8} more</li>}
        </ol>
      );

    case 'connector':
      if (!row.connectors.length) return <EmptyNote label="No connectors configured" />;
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {row.connectors.slice(0, 6).map((cn, i) => {
            const meta = getConnectorMeta(cn.name);
            return (
              <div key={i} className="flex items-center gap-2 p-1.5 rounded bg-primary/5 border border-card-border">
                <div className="w-7 h-7 rounded flex items-center justify-center shrink-0" style={{ background: `${meta?.color ?? '#60a5fa'}22` }}>
                  <ConnectorIcon meta={meta} size="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="typo-body font-semibold text-foreground truncate">{cn.label || cn.name}</span>
                  {cn.purpose && <span className="typo-label text-foreground/60 truncate">{cn.purpose}</span>}
                </div>
              </div>
            );
          })}
          {row.connectors.length > 6 && (
            <div className="flex items-center justify-center rounded border border-dashed border-card-border typo-label text-foreground/65">
              +{row.connectors.length - 6} more
            </div>
          )}
        </div>
      );

    case 'message': {
      const channels = parseChannels(row.messageSummary);
      if (!channels.length) return <EmptyNote label="No channels configured" />;
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
                  {ch.description && <span className="typo-label text-foreground/65 truncate">{ch.description}</span>}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    case 'review':
      return row.reviewSummary
        ? <p className="typo-body text-foreground leading-relaxed">{row.reviewSummary}</p>
        : <EmptyNote label="No review policy" />;

    case 'memory':
      return row.memorySummary
        ? <p className="typo-body text-foreground leading-relaxed">{row.memorySummary}</p>
        : <EmptyNote label="Memory not configured" />;

    case 'event':
      if (!row.events.length) return <EmptyNote label="No event subscriptions" />;
      return (
        <div className="flex flex-col gap-1.5">
          {row.events.map((e, i) => (
            <div key={i} className="flex flex-col gap-0.5 p-1.5 rounded bg-primary/5 border border-card-border">
              <span className="typo-body font-semibold text-foreground">{e.event_type}</span>
              {e.description && <span className="typo-label text-foreground/60">{e.description}</span>}
            </div>
          ))}
        </div>
      );

    case 'error':
      return row.errorSummary
        ? <p className="typo-body text-foreground leading-relaxed">{row.errorSummary}</p>
        : <EmptyNote label="No error handler" />;

    default:
      return <EmptyNote label="No content" />;
  }
}
