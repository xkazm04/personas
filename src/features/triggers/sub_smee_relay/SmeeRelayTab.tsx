import { silentCatch } from "@/lib/silentCatch";
import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Copy, Check, ExternalLink, Unplug, Plug,
  AlertCircle, Trash2, Pause, Play, Bot, Filter, X,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSmeeRelayStatus } from '@/hooks/realtime/useSmeeRelayStatus';
import { useAgentStore } from '@/stores/agentStore';
import {
  smeeRelayList, smeeRelayCreate, smeeRelaySetStatus, smeeRelayDelete,
  type SmeeRelay,
} from '@/api/system/cloud';
import { openExternalUrl } from '@/api/system/system';
import { formatRelativeTime } from '@/lib/utils/formatters';

interface SmeeRelayTabProps {
  onSwitchToLiveStream?: () => void;
}

export function SmeeRelayTab({ onSwitchToLiveStream }: SmeeRelayTabProps) {
  const globalStatus = useSmeeRelayStatus();
  const personas = useAgentStore((s) => s.personas);

  const [relays, setRelays] = useState<SmeeRelay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addPersonaId, setAddPersonaId] = useState('');
  const [addFilter, setAddFilter] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchRelays = useCallback(async () => {
    try {
      const list = await smeeRelayList();
      setRelays(list);
    } catch {
      // non-critical
    } finally {
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

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(silentCatch("SmeeRelayTab:copyToClipboard"));
  };

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
    } catch {
      // handled
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await smeeRelayDelete(id);
      setRelays((prev) => prev.filter((r) => r.id !== id));
      setConfirmDeleteId(null);
    } catch {
      // handled
    }
  };

  const activeCount = relays.filter((r) => r.status === 'active').length;
  const totalRelayed = relays.reduce((sum, r) => sum + r.eventsRelayed, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-5">
        {/* Aggregate status banner */}
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
          activeCount > 0
            ? 'bg-purple-500/5 border-purple-500/15'
            : 'bg-secondary/30 border-border/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${
              activeCount > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/30'
            }`} />
            <span className="text-sm text-foreground/80">
              {activeCount > 0
                ? `${activeCount} relay${activeCount !== 1 ? 's' : ''} active`
                : 'No active relays'}
            </span>
            {totalRelayed > 0 && (
              <span className="text-xs text-purple-400/70 font-medium">
                {totalRelayed} event{totalRelayed !== 1 ? 's' : ''} relayed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openExternalUrl('https://smee.io/new').catch(silentCatch("SmeeRelayTab:openSmeeNew"))}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors"
              title="Open smee.io/new to create a channel"
            >
              <ExternalLink className="w-3 h-3" />
              smee.io/new
            </button>
            {onSwitchToLiveStream && activeCount > 0 && (
              <button
                onClick={onSwitchToLiveStream}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-cyan-400/80 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
              >
                Live Stream
              </button>
            )}
          </div>
        </div>

        {/* Header + Add button */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
            Smee Relays
          </h3>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/15 transition-colors"
          >
            {showAdd ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showAdd ? 'Cancel' : 'Add Relay'}
          </button>
        </div>

        {/* Add relay form */}
        {showAdd && (
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground/80 mb-1.5">
                  Label
                </label>
                <input
                  type="text"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="e.g. GitHub — my-repo"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground/80 mb-1.5">
                  Channel URL
                </label>
                <input
                  type="text"
                  value={addUrl}
                  onChange={(e) => { setAddUrl(e.target.value); setCreateError(null); }}
                  placeholder="https://smee.io/your-channel-id"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground/80 mb-1.5">
                  Route to Agent <span className="text-muted-foreground/40">(optional)</span>
                </label>
                <select
                  value={addPersonaId}
                  onChange={(e) => setAddPersonaId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                >
                  <option value="">Broadcast to all</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground/80 mb-1.5">
                  Event Filter <span className="text-muted-foreground/40">(optional, comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={addFilter}
                  onChange={(e) => setAddFilter(e.target.value)}
                  placeholder="github_push, github_pull_request"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                />
              </div>
            </div>

            {createError && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle className="w-3 h-3" />
                {createError}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={handleCreate}
                disabled={isCreating || !addLabel.trim() || !addUrl.startsWith('https://smee.io/')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 disabled:opacity-50 transition-colors"
              >
                {isCreating ? <LoadingSpinner size="sm" /> : <Plug className="w-3.5 h-3.5" />}
                Create Relay
              </button>
              <p className="text-xs text-muted-foreground/50">
                Get a channel URL from <button onClick={() => openExternalUrl('https://smee.io/new').catch(silentCatch("SmeeRelayTab:openSmeeNewInline"))} className="text-purple-400/60 hover:text-purple-400 underline">smee.io/new</button>
              </p>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner size="lg" className="text-muted-foreground/60" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && relays.length === 0 && !showAdd && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Unplug className="w-7 h-7 text-purple-400/50" />
            </div>
            <p className="text-sm font-medium text-foreground/70">No Smee relays configured</p>
            <p className="text-sm text-muted-foreground/50 mt-1 max-w-sm">
              Add a Smee relay to receive GitHub webhooks and 3rd-party events in real-time through the event bus.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/15 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add First Relay
            </button>
          </div>
        )}

        {/* Relay list */}
        {!isLoading && relays.length > 0 && (
          <div className="space-y-2">
            {relays.map((relay) => {
              const persona = relay.targetPersonaId
                ? personas.find((p) => p.id === relay.targetPersonaId)
                : null;
              const isActive = relay.status === 'active';
              const isPaused = relay.status === 'paused';
              const isError = relay.status === 'error';
              const filters: string[] = relay.eventFilter
                ? (() => { try { return JSON.parse(relay.eventFilter!); } catch { return []; } })()
                : [];

              return (
                <div
                  key={relay.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    isError
                      ? 'border-red-500/20 bg-red-500/3'
                      : isPaused
                        ? 'border-border/20 bg-secondary/5 opacity-70'
                        : 'border-purple-500/15 bg-secondary/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Left side: info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {/* Status dot */}
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          isActive ? 'bg-emerald-400 animate-pulse' : isPaused ? 'bg-amber-400' : 'bg-red-400'
                        }`} />
                        <span className="text-sm font-semibold text-foreground/90 truncate">
                          {relay.label}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                          isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : isPaused ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {relay.status}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-muted-foreground/50 truncate mb-2">
                        {relay.channelUrl}
                      </p>

                      {/* Metadata row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        {relay.eventsRelayed > 0 && (
                          <span className="text-xs text-purple-400/60">
                            {relay.eventsRelayed} event{relay.eventsRelayed !== 1 ? 's' : ''}
                          </span>
                        )}
                        {relay.lastEventAt && (
                          <span className="text-xs text-muted-foreground/40">
                            Last: {formatRelativeTime(relay.lastEventAt)}
                          </span>
                        )}
                        {persona && (
                          <span className="inline-flex items-center gap-1 text-xs text-foreground/50">
                            <Bot className="w-3 h-3" style={{ color: persona.color ?? undefined }} />
                            {persona.name}
                          </span>
                        )}
                        {filters.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/40">
                            <Filter className="w-3 h-3" />
                            {filters.join(', ')}
                          </span>
                        )}
                      </div>

                      {/* Error message */}
                      {isError && relay.error && (
                        <div className="mt-2 flex items-start gap-1.5 text-xs text-red-400/80">
                          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span className="break-words">{relay.error}</span>
                        </div>
                      )}
                    </div>

                    {/* Right side: actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleCopy(relay.channelUrl, relay.id)}
                        className="p-1.5 rounded-lg text-foreground/50 hover:text-foreground hover:bg-secondary/50 transition-colors"
                        title="Copy channel URL"
                      >
                        {copiedId === relay.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleToggleStatus(relay)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          isActive
                            ? 'text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10'
                            : 'text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10'
                        }`}
                        title={isActive ? 'Pause relay' : 'Resume relay'}
                      >
                        {isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      {confirmDeleteId === relay.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(relay.id)}
                            className="px-2 py-1 rounded-lg text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 rounded-lg text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(relay.id)}
                          className="p-1.5 rounded-lg text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete relay"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
  return (
    <div className="rounded-xl border border-border/20 bg-secondary/5 p-5 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">
        How it works
      </h4>
      <div className="space-y-2 text-sm text-muted-foreground/60">
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">1</span>
          <p>Visit <span className="font-mono text-purple-400/60">smee.io/new</span> to create a free relay channel</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">2</span>
          <p>Add the relay here with a label and the channel URL</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">3</span>
          <p>Paste the channel URL as a webhook in GitHub / Stripe / any service</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400">4</span>
          <p>Events appear in Live Stream and route to your agents automatically</p>
        </div>
      </div>
    </div>
  );
}
