import { useMemo } from 'react';
import { X, ExternalLink, Pin, Zap, ListChecks, MessageSquare, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { PersonaChip, usePersonaIndex } from '../sub_teamWorkspace/teamStudio/boardShared';
import { humanizePayload, type Artifact } from './payloadView';
import { AUTHOR_KIND_META, authorName, isAuthorKind, itemAccent } from './collabRender';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * Full decomposed detail for a channel item — the modal half of the
 * "short line in the channel, full detail on click" split. The channel row
 * shows concise key metadata; this shows the complete, formatted content:
 * the primary message (markdown, the hero), a key-value grid of the remaining
 * fields, the artifact, and the raw payload pretty-printed (copyable).
 * Extraction goes through {@link humanizePayload} so the same payload renders
 * consistently here and in the row, no matter which keys a persona used.
 */

/** Decompose an item into headline text + supporting fields + artifact. */
function fullBody(item: TeamChannelItem): { text: string | null; fields: Array<[string, string]>; artifact: Artifact | null } {
  if (item.kind === 'step') {
    // The step/assignment title is the headline; the payload (task / error /
    // status the read-model synthesizes for review gates) becomes fields.
    const v = humanizePayload(item.extra);
    const fields = [...v.fields];
    if (v.primary && v.primary !== item.body) fields.unshift(['Task', v.primary]);
    return { text: item.body, fields, artifact: v.artifact };
  }
  if (item.kind === 'event') {
    const v = humanizePayload(item.extra);
    return { text: v.primary ?? item.body, fields: v.fields, artifact: v.artifact };
  }
  // memory / directive / agent voices / bridged Slack messages — the body IS
  // the content. A Slack row carries no payload to decompose; its author is
  // rendered by the header (authorName → the bridged display name).
  return { text: item.body, fields: [], artifact: null };
}

/** Pretty-print the raw payload when it's JSON (events), else null. */
function prettyRaw(item: TeamChannelItem): string | null {
  if (item.kind !== 'event' || !item.extra) return null;
  try {
    return JSON.stringify(JSON.parse(item.extra), null, 2);
  } catch {
    return null;
  }
}

/** Kind glyph for the machine rows (voiced kinds carry their own icon). */
const KIND_GLYPH: Record<string, LucideIcon> = {
  step: ListChecks,
  event: Zap,
  memory: Pin,
  directive: MessageSquare,
};

/** Importance 1-10 → the 5-dot editor's read-only twin (matches StreamRow). */
function ImportanceDots({ value, ariaLabel }: { value: number; ariaLabel: string }) {
  const filled = Math.round(Math.min(10, Math.max(1, value)) / 2);
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={ariaLabel}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < filled ? 'bg-amber-300/90' : 'bg-foreground/20'}`} />
      ))}
    </span>
  );
}

export function ChannelDetailModal({ item, onClose, onPin, pinned }: {
  item: TeamChannelItem | null;
  onClose: () => void;
  /** Pin this item into the team's long-term memory (hidden for memory rows). */
  onPin?: (item: TeamChannelItem) => void;
  pinned?: boolean;
}) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();
  const persona = item?.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = item ? itemAccent(item, persona) : '#9ca3af';
  const detail = useMemo(() => (item ? fullBody(item) : { text: null, fields: [] as Array<[string, string]>, artifact: null }), [item]);
  const raw = useMemo(() => (item ? prettyRaw(item) : null), [item]);
  const absolute = useMemo(() => {
    if (!item) return null;
    const d = new Date(item.at);
    return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  }, [item]);

  // A Slack row's `label` carries the author's display name (already the
  // headline), so the machine line says the kind instead of repeating it.
  const eventLabel =
    item?.kind === 'memory' ? `memory · ${item.label}`
      : item?.kind === 'slack' ? 'slack'
        : item?.label ?? '';

  const Glyph = item ? KIND_GLYPH[item.kind] : undefined;
  const copyText = detail.text ?? raw;

  return (
    <BaseModal
      isOpen={!!item}
      onClose={onClose}
      titleId="channel-detail-title"
      maxWidthClass="max-w-2xl"
      panelClassName="bg-background border border-primary/15 shadow-elevation-4 rounded-modal max-h-[85vh] flex flex-col overflow-hidden"
      staggerChildren={false}
    >
      {item && (
        <>
          {/* The author's accent as a real design element: a hairline band
              bleeding into a faint header tint, not just a colored ring. */}
          <div aria-hidden className="h-[3px] flex-shrink-0" style={{ background: `linear-gradient(90deg, ${accent} 0%, color-mix(in srgb, ${accent} 30%, transparent) 60%, transparent 100%)` }} />
          <div className="flex items-start gap-3.5 px-6 py-4 border-b border-primary/10 flex-shrink-0" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 7%, transparent), transparent)` }}>
            <span
              className="flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0 mt-0.5"
              style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)` }}
            >
              {/* Voiced authors (athena / director / slack) win over the persona
                  sprite: a bridged Slack row parks its Slack user id in
                  `personaId`, and an external human must never wear a team
                  member's face. */}
              {isAuthorKind(item.kind) && item.kind !== 'persona' ? (
                (() => { const M = AUTHOR_KIND_META[item.kind]; return <M.Icon className={`w-[18px] h-[18px] ${M.iconColor}`} />; })()
              ) : persona ? (
                <PersonaIcon icon={persona.icon} color={persona.color} size="w-5 h-5" />
              ) : Glyph ? (
                <Glyph className="w-4 h-4" style={{ color: accent }} />
              ) : (
                <span className="typo-caption text-foreground">·</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="channel-detail-title" className="typo-title-lg text-foreground truncate">
                {authorName(item, persona)}
              </h2>
              <p className="flex items-center gap-2 flex-wrap mt-0.5 min-w-0">
                {eventLabel && (
                  <span className="typo-code px-1.5 py-0.5 rounded-interactive bg-secondary/50 border border-primary/10 text-foreground truncate max-w-[16rem]">
                    {eventLabel}
                  </span>
                )}
                {absolute && <span className="typo-caption text-foreground whitespace-nowrap">{absolute}</span>}
                <span className="typo-caption text-muted whitespace-nowrap">
                  <RelativeTime timestamp={item.at} showTooltip={false} />
                </span>
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} className="flex-shrink-0">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {detail.text ? (
              <MarkdownRenderer content={detail.text} className="typo-body-lg leading-relaxed" />
            ) : detail.fields.length === 0 ? (
              <p className="typo-body text-foreground">{t.monitor.channel_no_body}</p>
            ) : null}
            {detail.fields.length > 0 && (
              <dl className="grid grid-cols-[minmax(6rem,9rem)_1fr] gap-x-4 gap-y-2.5 rounded-card border border-primary/10 bg-secondary/20 px-4 py-3.5">
                {detail.fields.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="typo-label text-foreground pt-px truncate">{k}</dt>
                    <dd className="typo-body text-foreground min-w-0 whitespace-pre-wrap break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {detail.artifact && (
              <a href={detail.artifact.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-body text-status-info hover:bg-secondary/60 transition-colors focus-ring">
                <ExternalLink className="w-4 h-4" /> {detail.artifact.label}
              </a>
            )}
            {/* Memory rows carry an importance (1-10) — rendered as the same
                5-dot scale the memory panel and stream row use. */}
            {item.kind === 'memory' && item.importance != null && (
              <p className="flex items-center gap-2">
                <span className="typo-label text-foreground">{t.monitor.channel_importance}</span>
                <ImportanceDots value={item.importance} ariaLabel={`${t.monitor.channel_importance} ${item.importance}`} />
              </p>
            )}
            {/* "HEARD BY" — who is subscribed to this event_type. Nothing else in
                the app shows who LISTENS to an event. It used to be a client-side
                fan-out over every member's subscriptions; the read-model now joins
                it server-side and hands us `consumers`. */}
            {item.consumers && item.consumers.length > 0 && (
              <div>
                <p className="typo-label text-foreground mb-2">{t.monitor.channel_heard_by}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {item.consumers.map((pid) => (
                    <PersonaChip key={pid} persona={personaIndex.get(pid)} />
                  ))}
                </div>
              </div>
            )}
            {raw && (
              <details className="group rounded-card border border-primary/10 overflow-hidden">
                <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer list-none select-none bg-secondary/25 hover:bg-secondary/40 transition-colors focus-ring">
                  <ChevronRight className="w-3.5 h-3.5 text-muted transition-transform group-open:rotate-90" />
                  <span className="typo-label text-foreground flex-1">{t.monitor.channel_raw_payload}</span>
                  {/* preventDefault keeps the copy click from toggling <details> */}
                  <span onClick={(e) => e.preventDefault()} className="opacity-0 group-hover:opacity-100 group-open:opacity-100 transition-opacity">
                    <CopyButton text={raw} />
                  </span>
                </summary>
                <pre className="border-t border-primary/10 bg-secondary/15 px-4 py-3 typo-code text-foreground overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap break-words">
                  {raw}
                </pre>
              </details>
            )}
          </div>

          <div className="flex items-center gap-2 px-6 py-3 border-t border-primary/10 bg-secondary/15 flex-shrink-0">
            {/* Source reference: the assignment this row belongs to, when it
                carries one — a quiet copyable handle, not a hyperlink (the
                channel surfaces own navigation). */}
            {item.assignmentId && (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span className="typo-label text-foreground">{t.monitor.conv_card_assignment}</span>
                <span className="typo-code px-1.5 py-0.5 rounded-interactive bg-secondary/50 border border-primary/10 text-foreground">
                  {item.assignmentId.slice(0, 8)}
                </span>
                <CopyButton text={item.assignmentId} tooltip={t.shared.copy_full_id} />
              </span>
            )}
            <span className="flex-1" />
            {copyText && <CopyButton text={copyText} label={t.monitor.channel_copy_message} />}
            {onPin && item.kind !== 'memory' && (
              <Button
                variant="secondary"
                size="sm"
                disabled={pinned}
                onClick={() => onPin(item)}
                className={pinned ? 'text-amber-300/90' : undefined}
              >
                <Pin className="w-3.5 h-3.5" />
                {pinned ? t.monitor.channel_pinned_memory : t.monitor.channel_pin_memory}
              </Button>
            )}
          </div>
        </>
      )}
    </BaseModal>
  );
}

export default ChannelDetailModal;
