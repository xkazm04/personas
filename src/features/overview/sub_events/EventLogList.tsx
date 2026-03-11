import { Zap, Activity, RefreshCw, AlertCircle, CheckCircle2, Clock, Loader2, Server, Bot, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { formatRelativeTime, EVENT_STATUS_COLORS, EVENT_TYPE_COLORS } from '@/lib/utils/formatters';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { PersonaEvent } from '@/lib/types/types';
import { useEventLog } from './libs/useEventLog';
import { EventDetailModal } from './EventDetailModal';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];

const GRID_COLS = 'grid-cols-[1fr_1fr_1.2fr_0.8fr_0.8fr]';

export default function EventLogList() {
  const {
    recentEvents, personas, availableTypes,
    statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    toggleSortDirection,
    page, setPage, totalPages,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId,
    isLoading, isRefreshing,
    filteredEvents, paginatedEvents,
    handleRefresh, getPersona,
  } = useEventLog();

  const typeOptions = [
    { value: 'all', label: 'All types' },
    ...availableTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
  ];

  const personaOptions = [
    { value: '', label: 'All personas' },
    ...personas.map((p) => ({ value: p.id, label: p.name })),
  ];

  const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Events"
        subtitle={`${filteredEvents.length} of ${recentEvents.length} event${recentEvents.length !== 1 ? 's' : ''}`}
        actions={
          <Button variant="ghost" size="icon-sm" onClick={handleRefresh} disabled={isRefreshing} title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        }
      />

      <ContentBody flex>
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 text-muted-foreground/80">
            <Loader2 className="w-8 h-8 mb-3 animate-spin text-primary/70" />
            <p className="text-sm">Loading events...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4 md:p-6">
            <EmptyState icon={Activity} title="No events yet" description="Events from webhooks, executions, and persona actions will appear here as your agents run." iconColor="text-indigo-400/80" iconContainerClassName="bg-indigo-500/10 border-indigo-500/20" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Grid header with inline filter dropdowns */}
            <div className={`grid ${GRID_COLS} gap-0 border-b border-primary/10 bg-background/80 backdrop-blur-sm relative z-20`}>
              <div className="px-2 py-1.5">
                <ThemedSelect
                  filterable
                  options={typeOptions}
                  value={typeFilter}
                  onValueChange={setTypeFilter}
                  placeholder="Type"
                  className="!px-2 !py-1 !text-xs !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 uppercase tracking-wider font-medium"
                />
              </div>
              <div className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-medium">Source</div>
              <div className="px-2 py-1.5">
                <ThemedSelect
                  filterable
                  options={personaOptions}
                  value={selectedPersonaId}
                  onValueChange={(v) => setSelectedPersonaId(v)}
                  placeholder="Persona"
                  className="!px-2 !py-1 !text-xs !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 uppercase tracking-wider font-medium"
                />
              </div>
              <div className="px-2 py-1.5">
                <ThemedSelect
                  filterable
                  options={STATUS_OPTIONS}
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                  placeholder="Status"
                  className="!px-2 !py-1 !text-xs !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 uppercase tracking-wider font-medium"
                />
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={toggleSortDirection}
                className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-medium text-right flex items-center justify-end gap-1"
              >
                Created
                <ArrowUpDown className="w-3 h-3" />
              </Button>
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto">
              {paginatedEvents.map((event: PersonaEvent, idx: number) => {
                const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
                const typeColor = EVENT_TYPE_COLORS[event.event_type]?.tailwind ?? 'text-muted-foreground';
                const targetPersona = getPersona(event.target_persona_id);
                const hoverAccent =
                  event.status === 'processing' ? 'hover:border-l-blue-400'
                  : event.status === 'completed' || event.status === 'processed' ? 'hover:border-l-emerald-400'
                  : event.status === 'failed' ? 'hover:border-l-red-400'
                  : 'hover:border-l-amber-400';

                return (
                  <div
                    key={event.id}
                    data-testid={`event-row-${event.id}`}
                    onClick={() => setSelectedEvent(event)}
                    className={`grid ${GRID_COLS} gap-0 cursor-pointer transition-colors border-b border-primary/5 border-l-2 border-l-transparent hover:bg-white/[0.05] ${hoverAccent} ${idx % 2 === 0 ? 'bg-white/[0.015]' : ''}`}
                  >
                    <div className="px-4 py-2.5 flex items-center min-w-0">
                      <span className={`text-sm font-medium truncate ${typeColor}`}>{event.event_type}</span>
                    </div>
                    <div className="px-4 py-2.5 flex items-center min-w-0">
                      <span className="text-sm text-foreground/70 truncate">{event.source_type}</span>
                    </div>
                    <div className="px-4 py-2.5 flex items-center min-w-0">
                      {targetPersona ? (
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0" style={{ backgroundColor: (targetPersona.color || '#6366f1') + '15' }}>
                            {targetPersona.icon || <Bot className="w-3.5 h-3.5 text-muted-foreground/80" />}
                          </div>
                          <span className="text-sm text-foreground/70 truncate">{targetPersona.name}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center border border-primary/10 bg-muted/20 flex-shrink-0">
                            <Server className="w-3.5 h-3.5 text-muted-foreground/70" />
                          </div>
                          <span className="text-sm text-muted-foreground/70 truncate">{event.source_type || 'System'}</span>
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-2.5 flex items-center">
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-lg font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
                        {event.status === 'completed' || event.status === 'processed' ? <CheckCircle2 className="w-3 h-3" />
                          : event.status === 'failed' ? <AlertCircle className="w-3 h-3" />
                          : event.status === 'processing' ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Clock className="w-3 h-3" />}
                        {event.status}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-end">
                      <span className="text-sm text-foreground/70">{formatRelativeTime(event.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-primary/10 bg-background/60">
                <span className="text-xs text-muted-foreground/80 font-mono">
                  Page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let p: number;
                    if (totalPages <= 5) {
                      p = i + 1;
                    } else if (page <= 3) {
                      p = i + 1;
                    } else if (page >= totalPages - 2) {
                      p = totalPages - 4 + i;
                    } else {
                      p = page - 2 + i;
                    }
                    return (
                      <Button
                        key={p}
                        variant={p === page ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        onClick={() => setPage(p)}
                        className={`w-7 h-7 text-xs font-mono ${
                          p === page
                            ? 'bg-primary/10 text-foreground/90 border border-primary/20'
                            : 'text-muted-foreground/80'
                        }`}
                      >
                        {p}
                      </Button>
                    );
                  })}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </ContentBody>

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </ContentBox>
  );
}
