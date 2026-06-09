import { useMemo } from 'react';
import { X, ExternalLink, Pin } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { usePersonaIndex } from '../sub_teamWorkspace/teamStudio/boardShared';
import { humanizePayload, type Artifact } from './payloadView';
import { AUTHOR_KIND_META, authorName, itemAccent } from './collabRender';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * Full decomposed detail for a channel item — the modal half of the
 * "short line in the channel, full detail on click" split. The channel row
 * shows concise key metadata; this shows the complete, formatted content:
 * the primary message (markdown), a detail list of the remaining fields, the
 * artifact, and the raw payload pretty-printed (copyable). Extraction goes
 * through {@link humanizePayload} so the same payload renders consistently
 * here and in the row, no matter which keys a persona used.
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
  // memory / directive / agent voices — the body IS the content.
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

export function ChannelDetailModal({ item, onClose }: { item: TeamChannelItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();
  const persona = item?.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = item ? itemAccent(item, persona) : '#9ca3af';
  const detail = useMemo(() => (item ? fullBody(item) : { text: null, fields: [] as Array<[string, string]>, artifact: null }), [item]);
  const raw = useMemo(() => (item ? prettyRaw(item) : null), [item]);

  const eventLabel = item?.kind === 'memory' ? `memory · ${item.label}` : item?.label ?? '';

  return (
    <BaseModal
      isOpen={!!item}
      onClose={onClose}
      titleId="channel-detail-title"
      maxWidthClass="max-w-2xl"
      panelClassName="bg-background border border-primary/15 shadow-elevation-4 rounded-modal max-h-[80vh] flex flex-col"
      staggerChildren={false}
    >
      {item && (
        <>
          <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-secondary/60 border flex-shrink-0" style={{ borderColor: accent }}>
              {persona ? (
                <PersonaIcon icon={persona.icon} color={persona.color} size="w-5 h-5" />
              ) : item.kind === 'memory' ? (
                <Pin className="w-4 h-4 text-amber-300/80" />
              ) : item.kind === 'athena' || item.kind === 'director' ? (
                (() => { const M = AUTHOR_KIND_META[item.kind as 'athena' | 'director']; return <M.Icon className={`w-4 h-4 ${M.iconColor}`} />; })()
              ) : (
                <span className="typo-caption text-foreground">·</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="channel-detail-title" className="typo-section-title truncate" style={{ color: accent }}>
                {authorName(item, persona)}
              </h2>
              <p className="typo-caption text-foreground">
                <span className="font-mono">{eventLabel}</span>
                <span className="text-foreground"> · </span>
                <RelativeTime timestamp={item.at} />
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {detail.text ? (
              <MarkdownRenderer content={detail.text} className="typo-body leading-relaxed" />
            ) : detail.fields.length === 0 ? (
              <p className="typo-body text-foreground">{t.monitor.channel_no_body}</p>
            ) : null}
            {detail.fields.length > 0 && (
              <dl className="rounded-card border border-primary/10 bg-secondary/15 divide-y divide-primary/8">
                {detail.fields.map(([k, v]) => (
                  <div key={k} className="flex gap-3 px-3 py-2">
                    <dt className="typo-caption uppercase tracking-wider text-foreground flex-shrink-0 w-32 truncate">{k}</dt>
                    <dd className="typo-body text-foreground/85 min-w-0 whitespace-pre-wrap break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {detail.artifact && (
              <a href={detail.artifact.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-body text-status-info hover:bg-secondary/60 transition-colors">
                <ExternalLink className="w-4 h-4" /> {detail.artifact.label}
              </a>
            )}
            {raw && (
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer list-none select-none">
                  <span className="typo-label uppercase tracking-wider text-foreground group-hover:text-foreground transition-colors">{t.monitor.channel_raw_payload}</span>
                  <CopyButton text={raw} />
                </summary>
                <pre className="mt-1.5 rounded-card border border-primary/10 bg-secondary/20 px-3 py-2 typo-caption font-mono text-foreground overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap break-words">
                  {raw}
                </pre>
              </details>
            )}
          </div>
        </>
      )}
    </BaseModal>
  );
}

export default ChannelDetailModal;
