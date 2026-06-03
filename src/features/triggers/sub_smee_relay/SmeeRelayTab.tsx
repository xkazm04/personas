import { silentCatch } from "@/lib/silentCatch";
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, ExternalLink, Unplug, Plug,
  AlertCircle, Trash2, Pause, Play, Filter, X, CheckCircle2,
} from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { CopyButton } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { useSmeeRelayStatus } from '@/hooks/realtime/useSmeeRelayStatus';
import { useAgentStore } from '@/stores/agentStore';
import {
  smeeRelayList, smeeRelayCreate, smeeRelaySetStatus, smeeRelayDelete,
  type SmeeRelay,
} from '@/api/system/cloud';
import { openExternalUrl } from '@/api/system/system';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';


interface SmeeRelayTabProps {
  onSwitchToLiveStream?: () => void;
}

export function SmeeRelayTab({ onSwitchToLiveStream }: SmeeRelayTabProps) {
  const { t } = useTranslation();
  const globalStatus = useSmeeRelayStatus();
  const personas = useAgentStore((s) => s.personas);

  const [relays, setRelays] = useState<SmeeRelay[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addPersonaId, setAddPersonaId] = useState('');
  const [addFilter, setAddFilter] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Track items being animated out
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());

  const fetchRelays = useCallback(async () => {
    try {
      const list = await smeeRelayList();
      setRelays(list);
    } catch (err) { silentCatch("features/triggers/sub_smee_relay/SmeeRelayTab:catch1")(err); } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchRelays(); }, [fetchRelays]);

  // Refresh relay stats when global status updates
  useEffect(() => {
    if (globalStatus.events_relayed > 0) {
      fetchRelays();
    }
  }, [globalStatus.events_relayed, fetchRelays]);


  const handleCreate = async () => {
    if (!addLabel.trim() || !addUrl.startsWith('https://smee.io/')) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const eventFilter = addFilter.trim()
        ? JSON.stringify(addFilter.split(',').map((s) => s.trim()).filter(Boolean))
        : null;
      await smeeRelayCreate({
        label: addLabel.trim(),
        channelUrl: addUrl.trim(),
        targetPersonaId: addPersonaId || null,
        eventFilter,
      });
      setShowAdd(false);
      setAddLabel('');
      setAddUrl('');
      setAddPersonaId('');
      setAddFilter('');
      setTouchedFields(new Set());
      await fetchRelays();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create relay');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleStatus = async (relay: SmeeRelay) => {
    const newStatus = relay.status === 'active' ? 'paused' : 'active';
    try {
      await smeeRelaySetStatus(relay.id, newStatus);
      await fetchRelays();
    } catch (err) { silentCatch("features/triggers/sub_smee_relay/SmeeRelayTab:catch2")(err); }
  };

  const handleDelete = async (id: string) => {
    try {
      await smeeRelayDelete(id);
      // Mark as exiting first so AnimatePresence can animate out
      setExitingIds((prev) => new Set(prev).add(id));
      // Remove from list after the exit animation duration
      setTimeout(() => {
        setRelays((prev) => prev.filter((r) => r.id !== id));
        setExitingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      }, 300);
      setConfirmDeleteId(null);
    } catch (err) { silentCatch("features/triggers/sub_smee_relay/SmeeRelayTab:catch3")(err); }
  };

  const markTouched = (field: string) =>
    setTouchedFields((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

  const labelValid = addLabel.trim().length > 0;
  const urlValid = addUrl.startsWith('https://smee.io/') && addUrl.length > 'https://smee.io/'.length;
  const urlPartiallyTyped = addUrl.length > 0;

  const labelError = touchedFields.has('label') && !labelValid ? 'Label is required' : null;
  const urlError = touchedFields.has('url') && !urlValid
    ? (!urlPartiallyTyped
        ? 'Channel URL is required'
        : !addUrl.startsWith('https://smee.io/')
          ? 'URL must start with https://smee.io/'
          : 'Enter the full channel URL (e.g. https://smee.io/abc123)')
    : null;

  const activeCount = relays.filter((r) => r.status === 'active').length;
  const totalRelayed = relays.reduce((sum, r) => sum + r.eventsRelayed, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-5">
        {/* Aggregate status banner */}
        <div className={`flex items-center justify-between px-4 py-3 rounded-modal border ${
          activeCount > 0
            ? 'bg-purple-500/5 border-purple-500/15'
            : 'bg-secondary/30 border-border/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${
              activeCount > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/30'
            }`} />
            <span className="typo-body text-foreground">
              {activeCount > 0
                ? `${activeCount} relay${activeCount !== 1 ? 's' : ''} active`
                : t.triggers.no_active_relays}
            </span>
            {totalRelayed > 0 && (
              <span className="typo-caption text-purple-400/70 font-medium">
                {totalRelayed} event{totalRelayed !== 1 ? 's' : ''} relayed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openExternalUrl('https://smee.io/new').catch(silentCatch("SmeeRelayTab:openSmeeNew"))}
              className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              title={t.triggers.smee_open_new_title}
            >
              <ExternalLink className="w-3 h-3" />
              <DebtText k="auto_smee_io_new_7ce5f637" />
            </button>
            {onSwitchToLiveStream && activeCount > 0 && (
              <button
                onClick={onSwitchToLiveStream}
                className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card text-cyan-400/80 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
              >
                {t.triggers.live_stream}
              </button>
            )}
          </div>
        </div>

        {/* Header + Add button */}
        <div className="flex items-center justify-between">
          <h3 className="typo-code font-mono text-foreground uppercase tracking-wider">
            {t.triggers.smee_relays}
          </h3>
          <button
            onClick={() => { setShowAdd(!showAdd); if (showAdd) setTouchedFields(new Set()); }}
            className="flex items-center gap-1.5 px-3 py-1.5 typo-body font-medium rounded-modal bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/15 transition-colors"
          >
            {showAdd ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showAdd ? t.common.cancel : t.triggers.add_relay}
          </button>
        </div>

        {/* Add relay form */}
        {showAdd && (
          <div className="rounded-modal border border-purple-500/20 bg-purple-500/5 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block typo-caption font-medium text-foreground mb-1.5">
                  {t.triggers.relay_label_field}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    onBlur={() => markTouched('label')}
                    placeholder={t.triggers.relay_label_placeholder}
                    className={`w-full px-3 py-2 pr-8 typo-body rounded-card border bg-secondary/30 text-foreground placeholder:text-foreground focus:outline-none focus:ring-1 transition-colors ${
                      labelError
                        ? 'border-red-500/40 focus:ring-red-500/40'
                        : labelValid && touchedFields.has('label')
                          ? 'border-emerald-500/40 focus:ring-emerald-500/40'
                          : 'border-border/40 focus:ring-purple-500/40'
                    }`}
                  />
                  {touchedFields.has('label') && labelValid && (
                    <CheckCircle2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-400" />
                  )}
                </div>
                {labelError && (
                  <p className="mt-1 typo-caption text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    {labelError}
                  </p>
                )}
              </div>
              <div>
                <label className="block typo-caption font-medium text-foreground mb-1.5">
                  {t.triggers.relay_channel_url_field}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={addUrl}
                    onChange={(e) => { setAddUrl(e.target.value); setCreateError(null); }}
                    onBlur={() => markTouched('url')}
                    placeholder={t.triggers.relay_channel_url_placeholder}
                    className={`w-full px-3 py-2 pr-8 typo-code rounded-card border bg-secondary/30 text-foreground font-mono placeholder:text-foreground focus:outline-none focus:ring-1 transition-colors ${
                      urlError
                        ? 'border-red-500/40 focus:ring-red-500/40'
                        : urlValid && touchedFields.has('url')
                          ? 'border-emerald-500/40 focus:ring-emerald-500/40'
                          : 'border-border/40 focus:ring-purple-500/40'
                    }`}
                  />
                  {touchedFields.has('url') && urlValid && (
                    <CheckCircle2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-400" />
                  )}
                </div>
                {urlError && (
                  <p className="mt-1 typo-caption text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    {urlError}
                  </p>
                )}
              </div>
              <div>
                <label className="block typo-caption font-medium text-foreground mb-1.5">
                  {t.triggers.relay_route_to_agent} <span className="text-foreground">{t.triggers.optional_suffix}</span>
                </label>
                <select
                  value={addPersonaId}
                  onChange={(e) => setAddPersonaId(e.target.value)}
                  className="w-full px-3 py-2 typo-body rounded-card border border-border/40 bg-secondary/30 text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                >
                  <option value="">{t.triggers.broadcast_to_all}</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block typo-caption font-medium text-foreground mb-1.5">
                  {t.triggers.relay_event_filter_field} <span className="text-foreground">{t.triggers.relay_event_filter_note}</span>
                </label>
                <input
                  type="text"
                  value={addFilter}
                  onChange={(e) => setAddFilter(e.target.value)}
                  placeholder={t.triggers.relay_filter_placeholder}
                  className="w-full px-3 py-2 typo-code rounded-card border border-border/40 bg-secondary/30 text-foreground font-mono placeholder:text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                />
              </div>
            </div>

            {createError && (
              <div className="flex items-center gap-2 typo-caption text-red-400">
                <AlertCircle className="w-3 h-3" />
                {createError}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={handleCreate}
                disabled={isCreating || !addLabel.trim() || !addUrl.startsWith('https://smee.io/')}
                className="flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-card bg-purple-500/15 text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 disabled:opacity-50 transition-colors"
              >
                {isCreating ? <LoadingSpinner size="sm" /> : <Plug className="w-3.5 h-3.5" />}
                {t.triggers.create_relay}
              </button>
              <p className="typo-caption text-foreground">
                {t.triggers.get_channel_url_prompt} <button onClick={() => openExternalUrl('https://smee.io/new').catch(silentCatch("SmeeRelayTab:openSmeeNewInline"))} className="text-purple-400/60 hover:text-purple-400 underline"><DebtText k="auto_smee_io_new_7ce5f637" /></button>
              </p>
            </div>
          </div>
        )}

        {/* Loading — shape-matched skeleton rows so chrome lands before data */}
        {isLoading && (
          <ListSkeleton rows={3} rowHeight={64} className="rounded-modal overflow-hidden" />
        )}

        {/* Empty state */}
        {!isLoading && relays.length === 0 && !showAdd && (
          <EmptyState
            icon={Unplug}
            iconColor="text-purple-400/60"
            iconContainerClassName="bg-purple-500/10 border-purple-500/20"
            title={t.triggers.no_smee_relays}
            subtitle={t.triggers.smee_relay_desc}
            action={{ label: t.triggers.add_first_relay, onClick: () => setShowAdd(true), icon: Plus }}
          />
        )}

        {/* Relay list */}
        {!isLoading && relays.length > 0 && (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
            {relays.filter((r) => !exitingIds.has(r.id)).map((relay) => {
              const persona = relay.targetPersonaId
                ? personas.find((p) => p.id === relay.targetPersonaId)
                : null;
              const isActive = relay.status === 'active';
              const isPaused = relay.status === 'paused';
              const isError = relay.status === 'error';
              const filters: string[] = parseJsonOrDefault(relay.eventFilter, []);

              return (
                <motion.div
                  key={relay.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: isPaused ? 0.7 : 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className={`rounded-modal border p-4 transition-[border-color,background-color] duration-300 ${
                    isError
                      ? 'border-red-500/20 bg-red-500/3'
                      : isPaused
                        ? 'border-border/20 bg-secondary/5'
                        : 'border-purple-500/15 bg-secondary/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Left side: info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {/* Status dot */}
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-[background-color] duration-300 ${
                          isActive ? 'bg-emerald-400 animate-pulse' : isPaused ? 'bg-amber-400' : 'bg-red-400'
                        }`} />
                        <span className="typo-heading font-semibold text-foreground/90 truncate">
                          {relay.label}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-input transition-[color,background-color,border-color] duration-300 ${
                          isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : isPaused ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {relay.status}
                        </span>
                      </div>
                      <p className="typo-code font-mono text-foreground truncate mb-2">
                        {relay.channelUrl}
                      </p>

                      {/* Metadata row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        {relay.eventsRelayed > 0 && (
                          <span className="typo-caption text-purple-400/60">
                            {relay.eventsRelayed} event{relay.eventsRelayed !== 1 ? 's' : ''}
                          </span>
                        )}
                        {relay.lastEventAt && (
                          <span className="typo-caption text-foreground">
                            {t.triggers.relay_last_event} {formatRelativeTime(relay.lastEventAt)}
                          </span>
                        )}
                        {persona && (
                          <span className="inline-flex items-center gap-1 typo-caption text-foreground">
                            <PersonaIcon icon={persona.icon} color={persona.color} size="w-3 h-3" />
                            {persona.name}
                          </span>
                        )}
                        {filters.length > 0 && (
                          <span className="inline-flex items-center gap-1 typo-caption text-foreground">
                            <Filter className="w-3 h-3" />
                            {filters.join(', ')}
                          </span>
                        )}
                      </div>

                      {/* Error message */}
                      {isError && relay.error && (
                        <div className="mt-2 flex items-start gap-1.5 typo-caption text-red-400/80">
                          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span className="break-words">{relay.error}</span>
                        </div>
                      )}
                    </div>

                    {/* Right side: actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <CopyButton text={relay.channelUrl} tooltip={t.triggers.copy_channel_url_title} />
                      <button
                        onClick={() => handleToggleStatus(relay)}
                        className={`p-1.5 rounded-card transition-colors ${
                          isActive
                            ? 'text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10'
                            : 'text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10'
                        }`}
                        title={isActive ? t.triggers.pause_relay : t.triggers.resume_relay}
                      >
                        {isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      {confirmDeleteId === relay.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(relay.id)}
                            className="px-2 py-1 rounded-card typo-caption font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                          >
                            {t.common.confirm}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 rounded-card typo-caption text-foreground hover:text-foreground transition-colors"
                          >
                            {t.common.cancel}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(relay.id)}
                          className="p-1.5 rounded-card text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title={t.triggers.relay_delete_title}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
            </AnimatePresence>
          </div>
        )}

        {/* Setup guide (collapsed) */}
        {relays.length === 0 && !showAdd && !isLoading && (
          <SetupGuide />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup guide (shows below empty state)
// ---------------------------------------------------------------------------

function SetupGuide() {
  const { t } = useTranslation();
  return (
    <div className="rounded-modal border border-border/20 bg-secondary/5 p-5 space-y-3">
      <h4 className="typo-label font-semibold uppercase tracking-wider text-foreground">
        {t.triggers.how_it_works}
      </h4>
      <div className="space-y-2 typo-body text-foreground">
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">1</span>
          <p>{t.triggers.setup_guide_step1}</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">2</span>
          <p>{t.triggers.setup_guide_step2}</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">3</span>
          <p>{t.triggers.setup_guide_step3}</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">4</span>
          <p>{t.triggers.setup_guide_step4}</p>
        </div>
      </div>
    </div>
  );
}
