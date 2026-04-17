import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, RefreshCw, Zap, MessageSquare } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { getEventTypeColor, getEventStatusColor } from '@/lib/design/eventTokens';
import { priorityConfig } from '@/features/overview/sub_messages/libs/messageHelpers';
import { useActivityTimeline, type TimelineItem, type TimelineEventItem, type TimelineMessageItem } from '../libs/useActivityTimeline';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';

type TimelineFilter = 'all' | 'events' | 'messages';

const FILTER_LABELS: Record<TimelineFilter, string> = {
  all: 'All',
  events: 'Events',
  messages: 'Messages',
};

// -- Entrance animation variants ------------------------------------------

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

// -- Event card -----------------------------------------------------------

function EventCard({ item }: { item: TimelineEventItem }) {
  const event = item.data;
  const typeColor = getEventTypeColor(event.event_type);
  const statusColor = getEventStatusColor(event.status);

  return (
    <div className="flex items-center gap-3 min-w-0">
      {/* Status dot + type icon on left rail */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={`w-2 h-2 rounded-full ${statusColor.bg} ${statusColor.border} border`} />
        <Zap className={`w-3.5 h-3.5 ${typeColor.tailwind}`} />
      </div>

      {/* Content */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-xs font-medium text-foreground/90 truncate">
          {event.event_type.replace(/_/g, ' ')}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor.bg} ${statusColor.text} border ${statusColor.border}`}>
          {event.status}
        </span>
        {item.personaName && (
          <span className="text-[10px] text-foreground truncate">
            <PersonaIcon icon={item.personaIcon} color={item.personaColor} display="pop" frameSize="lg" frameClass="mr-0.5" className="inline-flex" />
            {item.personaName}
          </span>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-[10px] text-foreground shrink-0 tabular-nums">
        {formatRelativeTime(event.created_at)}
      </span>
    </div>
  );
}

// -- Message card ---------------------------------------------------------

function MessageCard({ item }: { item: TimelineMessageItem }) {
  const msg = item.data;
  const pCfg = priorityConfig[msg.priority] ?? { color: 'text-foreground', bgColor: 'bg-secondary/30', borderColor: 'border-primary/15', label: 'Normal' };

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {/* Top row */}
      <div className="flex items-center gap-2 min-w-0">
        <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0" />

        {msg.persona_name && (
          <span className="text-[10px] text-foreground shrink-0">
            <PersonaIcon icon={msg.persona_icon} color={msg.persona_color} display="pop" frameSize="xs" frameClass="mr-0.5" className="inline-flex" />
            {msg.persona_name}
          </span>
        )}

        {msg.priority === 'high' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${pCfg.bgColor} ${pCfg.color} border ${pCfg.borderColor}`}>
            High
          </span>
        )}

        <span className="text-[10px] text-foreground ml-auto shrink-0 tabular-nums">
          {formatRelativeTime(msg.created_at)}
        </span>
      </div>

      {/* Title / content preview */}
      <div className={`text-xs truncate ${msg.is_read ? 'text-foreground' : 'text-foreground/90 font-medium'}`}>
        {msg.title || msg.content.slice(0, 120)}
      </div>
    </div>
  );
}

// -- TimelineItemRow (shared wrapper) -------------------------------------

function TimelineItemRow({ item }: { item: TimelineItem }) {
  const accentColor = item.kind === 'event'
    ? getEventTypeColor(item.data.event_type).hex
    : '#60a5fa'; // blue for messages

  return (
    <motion.div
      layout
      variants={itemVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="rounded-card bg-secondary/20 border border-primary/8 hover:border-primary/15 hover:bg-secondary/30 transition-colors px-3 py-2"
      style={{ borderLeftWidth: 2, borderLeftColor: accentColor }}
    >
      {item.kind === 'event'
        ? <EventCard item={item} />
        : <MessageCard item={item} />}
    </motion.div>
  );
}

// -- Main component -------------------------------------------------------

export default function UnifiedActivityTimeline() {
  const { t, tx } = useTranslation();
  const { items, isLoading, refresh } = useActivityTimeline();
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filtered = filter === 'all'
    ? items
    : items.filter((i) => (filter === 'events' ? i.kind === 'event' : i.kind === 'message'));

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const eventCount = items.filter((i) => i.kind === 'event').length;
  const messageCount = items.filter((i) => i.kind === 'message').length;

  return (
    <ContentBox>
      <ContentHeader
        title={t.overview.activity_timeline.title}
        icon={<Activity className="w-4 h-4" />}
        iconColor="cyan"
        subtitle={tx(t.overview.activity_timeline.subtitle, { events: eventCount, messages: messageCount })}
        actions={
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-input text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-40"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        }
      />
      <ContentBody>
        {/* Filter bar */}
        <div className="px-4 md:px-6 py-2 border-b border-primary/8">
          <FilterBar
            options={Object.entries(FILTER_LABELS).map(([id, label]) => ({ id: id as TimelineFilter, label }))}
            value={filter}
            onChange={setFilter}
            layoutIdPrefix="timeline-filter"
          />
        </div>

        {/* Timeline list */}
        {isLoading ? (
          <ContentLoader />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-foreground gap-2">
            <Activity className="w-8 h-8 opacity-40" />
            <p className="text-sm">{t.overview.activity_timeline.no_activity}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4 md:p-6 overflow-y-auto flex-1 min-h-0">
            <AnimatePresence mode="popLayout">
              {filtered.map((item) => (
                <TimelineItemRow key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
