import { useState } from 'react';
import { Copy, Check, Cloud, Unplug, AlertCircle, Clock, Hash, FolderOpen } from 'lucide-react';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import { BaseModal } from '@/lib/ui/BaseModal';
import { X } from 'lucide-react';
import { HighlightedJson } from './HighlightedJson';
import { formatRelativeTime, EVENT_STATUS_COLORS } from '@/lib/utils/formatters';
import type { PersonaEvent } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

interface EventDetailModalProps {
  event: PersonaEvent;
  onClose: () => void;
}

const SOURCE_ICONS: Record<string, { icon: typeof Cloud; color: string }> = {
  cloud_webhook: { icon: Cloud, color: 'text-blue-400' },
  smee_relay: { icon: Unplug, color: 'text-purple-400' },
};

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  const { t } = useTranslation();
  const [copiedPayload, setCopiedPayload] = useState(false);
  const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
  const sourceConfig = event.source_type ? SOURCE_ICONS[event.source_type] : null;
  const SourceIcon = sourceConfig?.icon;

  const handleCopy = () => {
    const text = (() => { try { return JSON.stringify(JSON.parse(event.payload!), null, 2); } catch { return event.payload!; } })();
    navigator.clipboard.writeText(text).then(() => {
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 2000);
    }).catch(() => { /* non-critical */ });
  };

  return (
    <BaseModal
        isOpen
        onClose={onClose}
        titleId="event-detail-modal-title"
        size="full"
        panelClassName="bg-background border border-primary/20 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col h-[90vh]"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-primary/10 flex-shrink-0 bg-secondary/10">
          <div className="flex-1 min-w-0 pr-4">
            {/* Improvement #9: Color-coded event type badge */}
            <div className="flex items-center gap-2.5 mb-1.5">
              <h3
                id="event-detail-modal-title"
                className="typo-body-lg font-semibold text-foreground tracking-tight"
              >
                {event.event_type}
              </h3>
              {/* Improvement #4: Status badge with color coding */}
              <span className={`inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full font-semibold ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
                {event.status}
              </span>
            </div>
            {/* Improvement #6: Relative + absolute timestamp */}
            <div className="flex items-center gap-1.5 typo-caption text-foreground">
              <Clock className="w-3 h-3" />
              <span>{formatRelativeTime(event.created_at)}</span>
              <span className="text-foreground">&middot;</span>
              <span className="font-mono">{new Date(event.created_at).toLocaleString()}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors focus-ring"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body — flex-1 so {t.triggers.event_data} fills remaining space ── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Improvement #7: Metadata grid with better visual hierarchy */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-primary/5 border-b border-primary/10 flex-shrink-0">
            <MetaCell icon={Hash} label={t.triggers.meta_event_id}>
              <UuidLabel value={event.id} />
            </MetaCell>
            <MetaCell icon={FolderOpen} label={t.triggers.meta_project}>
              <UuidLabel value={event.project_id} />
            </MetaCell>
            {/* Improvement #5: Source type icon + styled chip */}
            {event.source_id && (
              <MetaCell icon={SourceIcon ?? Hash} iconColor={sourceConfig?.color} label={t.triggers.meta_source}>
                <div className="flex items-center gap-1.5">
                  {event.source_type && (
                    <span className={`typo-caption font-medium px-1.5 py-0.5 rounded-input bg-secondary/50 border border-primary/10 ${sourceConfig?.color ?? 'text-foreground'}`}>
                      {event.source_type}
                    </span>
                  )}
                  <UuidLabel value={event.source_id} />
                </div>
              </MetaCell>
            )}
            {event.processed_at && (
              <MetaCell icon={Clock} label={t.triggers.meta_processed}>
                <span className="font-mono text-foreground">
                  {new Date(event.processed_at).toLocaleString()}
                </span>
              </MetaCell>
            )}
          </div>

          {/* Improvement #1: Event Data fills remaining modal height */}
          {event.payload && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Improvement #3: Themed section label */}
              <div className="flex items-center justify-between px-5 py-2.5 border-b border-primary/8 flex-shrink-0 bg-secondary/5">
                <span className="typo-label font-semibold uppercase tracking-wider text-foreground">
                  {t.triggers.event_data_section_label}
                </span>
                {/* Improvement #10: Copy button with improved hover/animation */}
                <button
                  onClick={handleCopy}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-card typo-caption font-medium transition-all duration-200 ${
                    copiedPayload
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'text-foreground hover:text-foreground hover:bg-secondary/60 border border-transparent hover:border-primary/10'
                  }`}
                  title={t.triggers.copy_event_data_title}
                >
                  {copiedPayload ? (
                    <>
                      <Check className="w-3 h-3" />
                      {t.triggers.copied_label}
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      {t.triggers.copy_json}
                    </>
                  )}
                </button>
              </div>
              {/* Improvement #2: JSON syntax highlighting + fills height */}
              <div className="flex-1 overflow-y-auto px-5 py-3 bg-[hsl(var(--background))]/60">
                <HighlightedJson raw={event.payload} />
              </div>
            </div>
          )}

          {/* If no payload, show empty state */}
          {!event.payload && !event.error_message && (
            <div className="flex-1 flex items-center justify-center text-foreground typo-body">
              {t.triggers.no_event_data}
            </div>
          )}

          {/* Improvement #8: Error section with icon and improved styling */}
          {event.error_message && (
            <div className="flex-shrink-0 border-t border-red-500/15 bg-red-500/3">
              <div className="flex items-center gap-2 px-5 py-2.5 border-b border-red-500/10">
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                <span className="typo-label font-semibold uppercase tracking-wider text-red-400/70">
                  {t.triggers.error_section_label}
                </span>
              </div>
              <div className="px-5 py-3">
                <pre className="typo-code font-mono text-red-400/90 whitespace-pre-wrap break-words leading-relaxed">
                  {event.error_message}
                </pre>
              </div>
            </div>
          )}
        </div>
      </BaseModal>
  );
}

/** Metadata cell for the info grid */
function MetaCell({ icon: Icon, iconColor, label, children }: {
  icon: typeof Hash;
  iconColor?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background/60 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${iconColor ?? 'text-foreground'}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {label}
        </span>
      </div>
      <div className="typo-body text-foreground truncate">
        {children}
      </div>
    </div>
  );
}
