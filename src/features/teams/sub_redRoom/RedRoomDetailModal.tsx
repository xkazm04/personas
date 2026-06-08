import { useMemo } from 'react';
import { X, ExternalLink, Pin, AlertTriangle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { PersonaChip, usePersonaIndex } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, memberColor, type RedRoomItem } from './useRedRoomFeed';

/**
 * Full-transmission detail modal — opened by clicking a row in any Red Room
 * variant. Shows the complete message: speaker (universal member colour),
 * event type + family, exact timestamp, full summary / memory content, error,
 * artifact links, who's listening, and the raw payload (pretty-printed JSON
 * when parseable) with a copy affordance.
 */

function prettyPayload(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const FAMILY_TEXT: Record<string, string> = {
  handoff: 'text-violet-300',
  pr: 'text-blue-300',
  qa: 'text-amber-300',
  release: 'text-emerald-300',
  failure: 'text-red-300',
  build: 'text-sky-300',
  other: 'text-foreground/60',
};

export function RedRoomDetailModal({ item, onClose }: { item: RedRoomItem | null; onClose: () => void }) {
  const personaIndex = usePersonaIndex();
  const persona = item?.personaId ? personaIndex.get(item.personaId) : undefined;
  const color = item ? memberColor(persona, item.personaId) : '#9ca3af';
  const payload = useMemo(
    () => (item?.kind === 'event' ? prettyPayload(item.payloadRaw) : null),
    [item],
  );

  return (
    <BaseModal
      isOpen={!!item}
      onClose={onClose}
      titleId="redroom-detail-title"
      maxWidthClass="max-w-2xl"
      panelClassName="bg-background border border-primary/15 shadow-elevation-4 rounded-modal max-h-[80vh] flex flex-col"
      staggerChildren={false}
    >
      {item && (
        <>
          {/* Header — speaker identity in their universal colour */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
            <span
              className="flex items-center justify-center w-9 h-9 rounded-full bg-secondary/60 border flex-shrink-0"
              style={{ borderColor: color }}
            >
              {persona ? (
                <PersonaIcon icon={persona.icon} color={persona.color} size="w-5 h-5" />
              ) : item.kind === 'memory' ? (
                <Pin className="w-4 h-4 text-amber-300/80" />
              ) : (
                <span className="typo-caption text-foreground/40">?</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="redroom-detail-title" className="typo-section-title truncate" style={{ color }}>
                {persona ? persona.name.replace(/^T: /, '') : item.kind === 'memory' ? 'Team memory' : 'System'}
              </h2>
              <p className="typo-caption text-foreground/55">
                {item.kind === 'event' ? (
                  <span className={`font-mono ${FAMILY_TEXT[eventFamily(item.eventType)] ?? FAMILY_TEXT.other}`}>
                    {item.eventType}
                  </span>
                ) : (
                  <span className="uppercase tracking-wider">{item.category}</span>
                )}
                <span className="text-foreground/40"> · {new Date(item.at).toLocaleString()}</span>
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {item.kind === 'memory' ? (
              <>
                <div>
                  <p className="typo-label uppercase tracking-wider text-foreground/55 mb-1">Title</p>
                  <p className="typo-body text-foreground">{item.title}</p>
                </div>
                <div>
                  <p className="typo-label uppercase tracking-wider text-foreground/55 mb-1">Content</p>
                  <p className="typo-body text-foreground/85 whitespace-pre-wrap">{item.content}</p>
                </div>
                <p className="typo-caption text-foreground/45">Importance {item.importance}</p>
              </>
            ) : (
              <>
                {item.summary && (
                  <div>
                    <p className="typo-label uppercase tracking-wider text-foreground/55 mb-1">Message</p>
                    <p className="typo-body text-foreground/90 whitespace-pre-wrap">{item.summary}</p>
                  </div>
                )}
                {item.errorMessage && (
                  <div className="rounded-card border border-red-500/25 bg-red-500/5 px-3 py-2">
                    <p className="flex items-center gap-1.5 typo-caption text-red-300">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {item.errorMessage}
                    </p>
                  </div>
                )}
                {item.artifact && (
                  <a
                    href={item.artifact.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-body text-foreground/85 hover:bg-secondary/60 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" /> {item.artifact.label}
                  </a>
                )}
                {item.consumers.length > 0 && (
                  <div>
                    <p className="typo-label uppercase tracking-wider text-foreground/55 mb-1.5">Heard by</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.consumers.map((pid) => (
                        <PersonaChip key={pid} persona={personaIndex.get(pid)} />
                      ))}
                    </div>
                  </div>
                )}
                {payload && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="typo-label uppercase tracking-wider text-foreground/55">Raw payload</p>
                      <CopyButton text={payload} />
                    </div>
                    <pre className="rounded-card border border-primary/10 bg-secondary/20 px-3 py-2 typo-caption font-mono text-foreground/75 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
                      {payload}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </BaseModal>
  );
}

export default RedRoomDetailModal;
