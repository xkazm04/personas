import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, ExternalLink, Plug,
  AlertCircle, Trash2, Pause, Play, Filter, X, CheckCircle2,
} from 'lucide-react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { CopyButton } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RELAY_GLYPH } from '@/features/shared/glyph/glyphs/relayGlyph';
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
import { useToastStore } from '@/stores/toastStore';
import { isValidSmeeChannelUrl, SMEE_CHANNEL_PREFIX } from './smeeChannelUrl';
import { inlineErrorCopy } from '../lib/inlineErrorCopy';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';


/** Minimum gap between per-relay stat refreshes while webhooks stream in. */
const RELAY_REFRESH_WINDOW_MS = 1500;

interface SmeeRelayTabProps {
  onSwitchToLiveStream?: () => void;
}

export function SmeeRelayTab({ onSwitchToLiveStream }: SmeeRelayTabProps) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const globalStatus = useSmeeRelayStatus();
  const personas = useAgentStore((s) => s.personas);

  const [relays, setRelays] = useState<SmeeRelay[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const formId = useId();
  const [addPersonaId, setAddPersonaId] = useState('');
  const [addFilter, setAddFilter] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  // The rejection itself, resolved at render (lib/inlineErrorCopy).
  const [createError, setCreateError] = useState<{ raw: unknown } | null>(null);
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // The list read's rejection: with no rows, "no relays" would be a false claim
  // that invites adding a duplicate of a relay that may still be running.
  const [loadError, setLoadError] = useState<{ raw: unknown } | null>(null);
  // Track items being animated out
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());

  const fetchRelays = useCallback(async () => {
    try {
      const list = await smeeRelayList();
      setRelays(list);
      setLoadError(null);
    } catch (err) {
      silentCatch("features/triggers/sub_smee_relay/SmeeRelayTab:catch1")(err);
      setLoadError({ raw: err });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchRelays(); }, [fetchRelays]);

  // Refresh relay stats when global status updates. The counter ticks once per
  // relayed webhook, so a push burst would otherwise cost one full list IPC per
  // delivery: throttle to one refresh per window, trailing so the last tick lands.
  const lastRefreshAt = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (globalStatus.eventsRelayed <= 0 || refreshTimer.current) return;
    const wait = Math.max(0, lastRefreshAt.current + RELAY_REFRESH_WINDOW_MS - Date.now());
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      lastRefreshAt.current = Date.now();
      void fetchRelays();
    }, wait);
  }, [globalStatus.eventsRelayed, fetchRelays]);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
  }, []);


  const handleCreate = async () => {
    if (!addLabel.trim() || !isValidSmeeChannelUrl(addUrl)) return;
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
      setCreateError({ raw: err });
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleStatus = async (relay: SmeeRelay) => {
    const newStatus = relay.status === 'active' ? 'paused' : 'active';
    try {
      await smeeRelaySetStatus(relay.id, newStatus);
      await fetchRelays();
    } catch (err) {
      toastCatch('features/triggers/sub_smee_relay/SmeeRelayTab:toggleStatus', t.triggers.relay_toggle_failed)(err);
    }
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
    } catch (err) {
      silentCatch("features/triggers/sub_smee_relay/SmeeRelayTab:catch3")(err);
      setConfirmDeleteId(null);
      addToast(t.triggers.relay_delete_failed, 'error');
    }
  };

  const markTouched = (field: string) =>
    setTouchedFields((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

  const labelValid = addLabel.trim().length > 0;
  const urlValid = isValidSmeeChannelUrl(addUrl);
  const urlPartiallyTyped = addUrl.trim().length > 0;

  const labelError = touchedFields.has('label') && !labelValid ? t.triggers.relay_err_label_required : null;
  const urlError = touchedFields.has('url') && !urlValid
    ? (!urlPartiallyTyped
        ? t.triggers.relay_err_url_required
        : !addUrl.trim().startsWith(SMEE_CHANNEL_PREFIX)
          ? t.triggers.relay_err_url_prefix
          : t.triggers.relay_err_url_incomplete)
    : null;

  const activeCount = relays.filter((r) => r.status === 'active').length;
  const totalRelayed = relays.reduce((sum, r) => sum + Number(r.eventsRelayed), 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-5">
        {/* Aggregate status banner */}
        <div className={`flex items-center justify-between px-4 py-3 rounded-modal border ${
          activeCount > 0
            ? 'bg-role-agent/5 border-role-agent/15'
            : 'bg-surface-1 border-hair'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${
              activeCount > 0 ? 'bg-status-success animate-pulse' : 'bg-muted-foreground/30'
            }`} />
            <span className="typo-body text-ink-1">
              {activeCount > 0
                ? tx(activeCount === 1 ? t.triggers.relay_active_one : t.triggers.relay_active_other, { count: activeCount })
                : t.triggers.no_active_relays}
            </span>
            {totalRelayed > 0 && (
              <span className="typo-caption text-role-agent">
                {tx(totalRelayed === 1 ? t.triggers.relay_events_relayed_one : t.triggers.relay_events_relayed_other, { count: totalRelayed })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => openExternalUrl('https://smee.io/new').catch(silentCatch("SmeeRelayTab:openSmeeNew"))}
              tooltip={t.triggers.smee_open_new_title}
              variant="ghost"
              size="sm"
              icon={<ExternalLink className="w-3 h-3" />}
            ><DebtText k="auto_smee_io_new_7ce5f637" /></Button>
            {onSwitchToLiveStream && activeCount > 0 && (
              <Button type="button" onClick={onSwitchToLiveStream} variant="ghost" size="sm">{t.triggers.live_stream}</Button>
            )}
          </div>
        </div>

        {/* Header + Add button */}
        <div className="flex items-center justify-between">
          <h3 className="typo-eyebrow text-ink-1">
            {t.triggers.smee_relays}
          </h3>
          <Button
            type="button"
            onClick={() => { setShowAdd(!showAdd); if (showAdd) setTouchedFields(new Set()); }}
            variant="accent"
            tone="agent"
            size="sm"
            icon={showAdd ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          >{showAdd ? t.common.cancel : t.triggers.add_relay}</Button>
        </div>

        {/* Add relay form */}
        {showAdd && (
          <div className="rounded-modal border border-role-agent/20 bg-role-agent/5 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${formId}-label`} className="block typo-caption text-ink-2 mb-1.5">
                  {t.triggers.relay_label_field}
                </label>
                <div className="relative">
                  <input
                    id={`${formId}-label`}
                    aria-invalid={labelError ? true : undefined}
                    aria-describedby={labelError ? `${formId}-label-error` : undefined}
                    type="text"
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    onBlur={() => markTouched('label')}
                    placeholder={t.triggers.relay_label_placeholder}
                    className={`w-full px-3 py-2 pr-8 typo-body rounded-card border bg-surface-1 text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-1 transition-colors ${
                      labelError
                        ? 'border-status-error/40 focus:ring-status-error/40'
                        : labelValid && touchedFields.has('label')
                          ? 'border-status-success/40 focus:ring-status-success/40'
                          : 'border-hair focus:ring-role-agent/40'
                    }`}
                  />
                  {touchedFields.has('label') && labelValid && (
                    <CheckCircle2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-status-success" />
                  )}
                </div>
                {labelError && (
                  <p id={`${formId}-label-error`} className="mt-1 typo-caption text-status-error flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    {labelError}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={`${formId}-url`} className="block typo-caption text-ink-2 mb-1.5">
                  {t.triggers.relay_channel_url_field}
                </label>
                <div className="relative">
                  <input
                    id={`${formId}-url`}
                    aria-invalid={urlError ? true : undefined}
                    aria-describedby={urlError ? `${formId}-url-error` : undefined}
                    type="text"
                    value={addUrl}
                    onChange={(e) => { setAddUrl(e.target.value); setCreateError(null); }}
                    onBlur={() => markTouched('url')}
                    placeholder={t.triggers.relay_channel_url_placeholder}
                    className={`w-full px-3 py-2 pr-8 typo-code rounded-card border bg-surface-1 text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-1 transition-colors ${
                      urlError
                        ? 'border-status-error/40 focus:ring-status-error/40'
                        : urlValid && touchedFields.has('url')
                          ? 'border-status-success/40 focus:ring-status-success/40'
                          : 'border-hair focus:ring-role-agent/40'
                    }`}
                  />
                  {touchedFields.has('url') && urlValid && (
                    <CheckCircle2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-status-success" />
                  )}
                </div>
                {urlError && (
                  <p id={`${formId}-url-error`} className="mt-1 typo-caption text-status-error flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    {urlError}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={`${formId}-agent`} className="block typo-caption text-ink-2 mb-1.5">
                  {t.triggers.relay_route_to_agent} <span className="text-ink-1">{t.triggers.optional_suffix}</span>
                </label>
                <ThemedSelect
                  id={`${formId}-agent`}
                  value={addPersonaId}
                  onChange={(e) => setAddPersonaId(e.target.value)}
                >
                  <option value="">{t.triggers.broadcast_to_all}</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </ThemedSelect>
              </div>
              <div>
                <label htmlFor={`${formId}-filter`} className="block typo-caption text-ink-2 mb-1.5">
                  {t.triggers.relay_event_filter_field} <span className="text-ink-1">{t.triggers.relay_event_filter_note}</span>
                </label>
                <input
                  id={`${formId}-filter`}
                  type="text"
                  value={addFilter}
                  onChange={(e) => setAddFilter(e.target.value)}
                  placeholder={t.triggers.relay_filter_placeholder}
                  className="w-full px-3 py-2 typo-code rounded-card border border-hair bg-surface-1 text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-role-agent/40"
                />
              </div>
            </div>

            {createError && (
              <div className="flex items-center gap-2 typo-caption text-status-error">
                <AlertCircle className="w-3 h-3" />
                {inlineErrorCopy(t, createError.raw, t.triggers.relay_create_failed)}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleCreate}
                disabled={isCreating || !addLabel.trim() || !urlValid}
                variant="accent"
                tone="agent"
                size="md"
                icon={isCreating ? <LoadingSpinner size="sm" /> : <Plug className="w-3.5 h-3.5" />}
              >{t.triggers.create_relay}</Button>
              <p className="typo-caption text-ink-2">
                {t.triggers.get_channel_url_prompt} <Button variant="link" size="inline" onClick={() => openExternalUrl('https://smee.io/new').catch(silentCatch("SmeeRelayTab:openSmeeNewInline"))}><DebtText k="auto_smee_io_new_7ce5f637" /></Button>
              </p>
            </div>
          </div>
        )}

        {/* Loading — calm, delay-hidden ghost rows (docs/design/overview-loading.md
            §C): invisible for the first 150ms so a fast fetch never paints one. */}
        {isLoading && (
          <div className="animate-fade-in" style={{ animationDelay: '150ms' }}>
            <ListSkeleton calm rows={3} rowHeight={64} className="rounded-modal overflow-hidden" />
          </div>
        )}

        {/* A failed read with rows listed keeps them; only the claim of none is false. */}
        {!isLoading && relays.length === 0 && loadError && (
          <InlineErrorBanner
            severity="error"
            message={inlineErrorCopy(t, loadError.raw)}
            onRetry={fetchRelays}
          />
        )}

        {/* Empty state */}
        {!isLoading && relays.length === 0 && !loadError && !showAdd && (
          <EmptyState
            glyph={RELAY_GLYPH}
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
                      ? 'border-status-error/20 bg-status-error/3'
                      : isPaused
                        ? 'border-hair bg-surface-1'
                        : 'border-role-agent/15 bg-surface-1'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Left side: info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {/* Status dot */}
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-[background-color] duration-300 ${
                          isActive ? 'bg-status-success animate-pulse' : isPaused ? 'bg-status-warning' : 'bg-status-error'
                        }`} />
                        <span className="typo-heading text-ink-1 truncate">
                          {relay.label}
                        </span>
                        <span className={`typo-eyebrow px-1.5 py-0.5 rounded-input transition-[color,background-color,border-color] duration-300 ${
                          isActive ? 'bg-status-success/10 text-status-success border border-status-success/20'
                            : isPaused ? 'bg-status-warning/10 text-status-warning border border-status-warning/20'
                            : 'bg-status-error/10 text-status-error border border-status-error/20'
                        }`}>
                          {relay.status}
                        </span>
                      </div>
                      <p className="typo-code text-ink-1 truncate mb-2">
                        {relay.channelUrl}
                      </p>

                      {/* Metadata row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        {relay.eventsRelayed > 0 && (
                          <span className="typo-caption text-role-agent">
                            {Number(relay.eventsRelayed)} event{Number(relay.eventsRelayed) !== 1 ? 's' : ''}
                          </span>
                        )}
                        {relay.lastEventAt && (
                          <span className="typo-caption text-ink-2">
                            {t.triggers.relay_last_event} {formatRelativeTime(relay.lastEventAt)}
                          </span>
                        )}
                        {persona && (
                          <span className="inline-flex items-center gap-1 typo-caption text-ink-2">
                            <PersonaIcon icon={persona.icon} color={persona.color} size="w-3 h-3" />
                            {persona.name}
                          </span>
                        )}
                        {filters.length > 0 && (
                          <span className="inline-flex items-center gap-1 typo-caption text-ink-2">
                            <Filter className="w-3 h-3" />
                            {filters.join(', ')}
                          </span>
                        )}
                      </div>

                      {/* Error message */}
                      {isError && relay.error && (
                        <div className="mt-2 flex items-start gap-1.5 typo-caption text-status-error">
                          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span className="break-words">{relay.error}</span>
                        </div>
                      )}
                    </div>

                    {/* Right side: actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <CopyButton text={relay.channelUrl} tooltip={t.triggers.copy_channel_url_title} />
                      <Tooltip content={isActive ? t.triggers.pause_relay : t.triggers.resume_relay}><Button variant="accent" tone={isActive ? 'warning' : 'success'} size="icon-sm" onClick={() => handleToggleStatus(relay)}>
                        {isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </Button></Tooltip>
                      {confirmDeleteId === relay.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            onClick={() => handleDelete(relay.id)}
                            variant="danger"
                            size="xs"
                          >{t.common.confirm}</Button>
                          <Button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            variant="ghost"
                            size="xs"
                          >{t.common.cancel}</Button>
                        </div>
                      ) : (
                        <Button aria-label={t.triggers.relay_delete_title}
                          type="button"
                          onClick={() => setConfirmDeleteId(relay.id)}
                          tooltip={t.triggers.relay_delete_title}
                          variant="danger"
                          size="icon-sm"
                          icon={<Trash2 className="w-3.5 h-3.5" />}
                        />
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
        {relays.length === 0 && !loadError && !showAdd && !isLoading && (
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
    <div className="rounded-modal border border-hair bg-surface-1 p-5 space-y-3">
      <h4 className="typo-label text-ink-1">
        {t.triggers.how_it_works}
      </h4>
      <div className="space-y-2 typo-body text-ink-1">
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-role-agent/10 border border-role-agent/20 flex items-center justify-center typo-caption text-role-agent">1</span>
          <p>{t.triggers.setup_guide_step1}</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-role-agent/10 border border-role-agent/20 flex items-center justify-center typo-caption text-role-agent">2</span>
          <p>{t.triggers.setup_guide_step2}</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-role-agent/10 border border-role-agent/20 flex items-center justify-center typo-caption text-role-agent">3</span>
          <p>{t.triggers.setup_guide_step3}</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-role-agent/10 border border-role-agent/20 flex items-center justify-center typo-caption text-role-agent">4</span>
          <p>{t.triggers.setup_guide_step4}</p>
        </div>
      </div>
    </div>
  );
}
