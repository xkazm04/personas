import { useMemo } from 'react';
import { X, ExternalLink, Pin } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { usePersonaIndex } from '../sub_teamWorkspace/teamStudio/boardShared';
import { parsePayload } from '../sub_redRoom/useRedRoomFeed';
import { AUTHOR_KIND_META, authorName, itemAccent } from './collabRender';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * Full decomposed detail for a channel item — the modal half of the
 * "short line in the channel, full detail on click" split. The channel row
 * shows concise key metadata; this shows the complete, formatted content:
 * the full message (markdown), parsed artifact, and the raw payload
 * pretty-printed (copyable) for events whose decrypted payload is JSON.
 */

/** Pull the full readable body for an item (NOT length-capped, unlike the row). */
function fullBody(item: TeamChannelItem): { text: string | null; artifactUrl: string | null; artifactLabel: string | null } {
  if (item.kind === 'event') {
    // Re-derive the artifact, but read the WHOLE message field (no slice).
    const { artifact } = parsePayload(item.extra);
    let text: string | null = null;
    if (item.extra) {
      try {
        const o = JSON.parse(item.extra) as Record<string, unknown>;
        for (const k of ['summary', 'message', 'title', 'description', 'reason', 'task', 'goal', 'verdict', 'note', 'content']) {
          const v = o[k];
          if (typeof v === 'string' && v.trim()) { text = v.trim(); break; }
        }
      } catch {
        text = item.extra; // plain text payload
      }
    }
    return { text, artifactUrl: artifact?.url ?? null, artifactLabel: artifact?.label ?? null };
  }
  return { text: item.body, artifactUrl: null, artifactLabel: null };
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
  const personaIndex = usePersonaIndex();
  const persona = item?.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = item ? itemAccent(item, persona) : '#9ca3af';
  const detail = useMemo(() => (item ? fullBody(item) : { text: null, artifactUrl: null, artifactLabel: null }), [item]);
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
                <span className="typo-caption text-foreground/40">·</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="channel-detail-title" className="typo-section-title truncate" style={{ color: accent }}>
                {authorName(item, persona)}
              </h2>
              <p className="typo-caption text-foreground/55">
                <span className="font-mono">{eventLabel}</span>
                <span className="text-foreground/40"> · </span>
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
            ) : (
              <p className="typo-body text-foreground/45">No message body.</p>
            )}
            {detail.artifactUrl && (
              <a href={detail.artifactUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-body text-status-info hover:bg-secondary/60 transition-colors">
                <ExternalLink className="w-4 h-4" /> {detail.artifactLabel ?? 'Open'}
              </a>
            )}
            {raw && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="typo-label uppercase tracking-wider text-foreground/55">Full event payload</p>
                  <CopyButton text={raw} />
                </div>
                <pre className="rounded-card border border-primary/10 bg-secondary/20 px-3 py-2 typo-caption font-mono text-foreground/75 overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap break-words">
                  {raw}
                </pre>
              </div>
            )}
          </div>
        </>
      )}
    </BaseModal>
  );
}

export default ChannelDetailModal;
