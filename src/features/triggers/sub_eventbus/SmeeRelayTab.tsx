import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Copy, Check, ExternalLink, Loader2, Unplug, Plug, AlertCircle, Zap, Activity } from 'lucide-react';
import { useSmeeRelayStatus } from '@/hooks/realtime/useSmeeRelayStatus';
import { smeeGetChannelUrl, smeeSetChannelUrl, smeeDisconnect } from '@/api/system/cloud';
import { openExternalUrl } from '@/api/system/system';
import { formatRelativeTime } from '@/lib/utils/formatters';

type SetupStep = 1 | 2 | 3 | 4;

interface SmeeRelayTabProps {
  onSwitchToLiveStream?: () => void;
}

export function SmeeRelayTab({ onSwitchToLiveStream }: SmeeRelayTabProps) {
  const relay = useSmeeRelayStatus();

  const [channelUrl, setChannelUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [channelOpened, setChannelOpened] = useState(false);

  // Test webhook state
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // Load saved channel URL on mount
  useEffect(() => {
    smeeGetChannelUrl().then((url) => {
      if (url) {
        setSavedUrl(url);
        setChannelUrl(url);
      }
    }).catch(() => {});
  }, []);

  // Only mark as saved once the relay actually confirms connection.
  useEffect(() => {
    if (relay.connected && relay.channel_url) {
      setSavedUrl(relay.channel_url);
      setIsConnecting(false);
      setConnectError(null);
    }
  }, [relay.connected, relay.channel_url]);

  // If relay reports error while we're waiting for connection, treat as failure
  useEffect(() => {
    if (relay.error && isConnecting) {
      setConnectError(relay.error);
      setIsConnecting(false);
      smeeDisconnect().catch(() => {});
      setSavedUrl(null);
    }
  }, [relay.error, isConnecting]);

  const handleConnect = useCallback(async () => {
    if (!channelUrl.startsWith('https://smee.io/')) return;
    setIsConnecting(true);
    setConnectError(null);
    try {
      await smeeSetChannelUrl(channelUrl);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to save channel URL');
      setIsConnecting(false);
    }
  }, [channelUrl]);

  const handleDisconnect = useCallback(async () => {
    try {
      await smeeDisconnect();
      setSavedUrl(null);
      setChannelUrl('');
      setConnectError(null);
      setTestSuccess(false);
      setTestError(null);
    } catch {
      // handled
    }
  }, []);

  const handleCopyUrl = useCallback(() => {
    const url = savedUrl || channelUrl;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [savedUrl, channelUrl]);

  const handleTestWebhook = useCallback(async () => {
    const url = savedUrl || channelUrl;
    if (!url) return;
    setIsTesting(true);
    setTestError(null);
    setTestSuccess(false);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'test_ping',
          source: 'personas_desktop',
          timestamp: new Date().toISOString(),
          message: 'Webhook relay test from Personas Event Bus',
        }),
      });
      if (resp.ok) {
        setTestSuccess(true);
      } else {
        setTestError(`HTTP ${resp.status} — ${resp.statusText}`);
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsTesting(false);
    }
  }, [savedUrl, channelUrl]);

  const isConnected = relay.connected && !!savedUrl;

  // Derive which setup step the user is on
  const currentStep: SetupStep = isConnected
    ? (testSuccess ? 4 : 3)
    : (channelUrl || channelOpened) ? 2 : 1;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6 max-w-2xl">
        {/* Status banner */}
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
          isConnected
            ? 'bg-emerald-500/5 border-emerald-500/15'
            : isConnecting
              ? 'bg-amber-500/5 border-amber-500/15'
              : 'bg-secondary/30 border-border/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-400' : isConnecting ? 'bg-amber-400 animate-pulse' : 'bg-muted-foreground/30'
            }`} />
            <span className="text-sm text-foreground/80">
              {isConnected ? 'Relay connected — receiving webhooks' : isConnecting ? 'Connecting to Smee channel...' : 'Not configured'}
            </span>
            {relay.events_relayed > 0 && (
              <span className="text-xs text-purple-400/70 font-medium">
                {relay.events_relayed} event{relay.events_relayed !== 1 ? 's' : ''} relayed
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {relay.last_event_at && (
              <span className="text-xs text-muted-foreground/50">
                Last: {formatRelativeTime(relay.last_event_at)}
              </span>
            )}
            {isConnected && (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                <Unplug className="w-3 h-3" />
                Disconnect
              </button>
            )}
          </div>
        </div>

        {/* Connection error */}
        {connectError && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-500/8 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-400">Connection failed</p>
              <p className="text-xs text-red-400/70 mt-0.5">{connectError}</p>
            </div>
          </div>
        )}

        {/* Setup stepper — GitHub webhook integration guide */}
        <div className="space-y-1">
          <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider mb-4">
            Connect GitHub Webhooks to Event Bus
          </h3>

          {/* Step 1: Get a Smee channel */}
          <StepCard
            n={1}
            title="Create a Smee relay channel"
            description="Smee.io (by GitHub) provides a free public URL that relays webhook POSTs to your desktop app in real-time."
            active={currentStep === 1}
            done={currentStep > 1}
          >
            <button
              onClick={() => { openExternalUrl('https://smee.io/new').catch(() => {}); setChannelOpened(true); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open smee.io/new in browser
            </button>
            <p className="text-xs text-muted-foreground/50 mt-2">
              Copy the channel URL from the page that opens (it looks like https://smee.io/AbCdEfGh...)
            </p>
          </StepCard>

          {/* Step 2: Paste URL and connect */}
          <StepCard
            n={2}
            title="Paste channel URL and connect"
            description="Paste the Smee URL you copied and connect to start receiving events."
            active={currentStep === 2}
            done={currentStep > 2}
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={channelUrl}
                onChange={(e) => { setChannelUrl(e.target.value); setConnectError(null); }}
                placeholder="https://smee.io/your-channel-id"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
              />
              <button
                onClick={handleConnect}
                disabled={isConnecting || !channelUrl.startsWith('https://smee.io/')}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 disabled:opacity-50 transition-colors"
              >
                {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </StepCard>

          {/* Step 3: Configure GitHub webhook + test */}
          <StepCard
            n={3}
            title="Configure GitHub webhook and verify"
            description="Add the Smee URL as a webhook in your GitHub repo, then send a test to verify the relay works."
            active={currentStep === 3}
            done={currentStep > 3}
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground/70">GitHub → Settings → Webhooks → Add webhook</p>
                <ConfigRow label="Payload URL" value={savedUrl || channelUrl || 'https://smee.io/...'} onCopy={handleCopyUrl} copied={copied} />
                <ConfigRow label="Content type" value="application/json" />
                <ConfigRow label="Secret" value="(leave empty for Smee relay)" />
                <ConfigRow label="Events" value='Select "Send me everything" or pick individual events' />
              </div>

              <div className="border-t border-border/15 pt-3">
                <p className="text-xs text-muted-foreground/60 mb-2">
                  Or send a quick test to verify the relay before configuring GitHub:
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestWebhook}
                    disabled={isTesting || !isConnected}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
                  >
                    {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {isTesting ? 'Sending...' : 'Send Test Webhook'}
                  </button>
                  {testSuccess && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                      <Check className="w-3 h-3" /> Test received
                    </span>
                  )}
                  {testError && (
                    <span className="text-xs text-red-400">{testError}</span>
                  )}
                </div>
              </div>
            </div>
          </StepCard>

          {/* Step 4: Done — go to Live Stream */}
          <StepCard
            n={4}
            title="Events flowing into Event Bus"
            description="Your webhook relay is working. Events from GitHub will appear in real-time."
            active={currentStep === 4}
            done={false}
          >
            <div className="space-y-3">
              <p className="text-sm text-foreground/70">
                GitHub events will appear as <code className="text-purple-400/80 text-xs">github_push</code>, <code className="text-purple-400/80 text-xs">github_pull_request</code>, <code className="text-purple-400/80 text-xs">github_issues</code> etc. in the Live Stream.
                Agents with matching event subscriptions will activate automatically.
              </p>
              {onSwitchToLiveStream && (
                <button
                  onClick={onSwitchToLiveStream}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-cyan-500/15 text-cyan-400 border border-cyan-500/25 hover:bg-cyan-500/25 transition-colors"
                >
                  <Activity className="w-3.5 h-3.5" />
                  Open Live Stream
                </button>
              )}
            </div>
          </StepCard>
        </div>

        {/* Connected state — quick reference card */}
        {isConnected && (
          <div className="rounded-xl border border-border/30 bg-secondary/10 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
              <GitBranch className="w-4 h-4 text-muted-foreground/60" />
              GitHub Webhook Quick Reference
            </div>
            <div className="space-y-1.5">
              <ConfigRow label="Payload URL" value={savedUrl!} onCopy={handleCopyUrl} copied={copied} compact />
              <ConfigRow label="Content type" value="application/json" compact />
            </div>
            <p className="text-xs text-muted-foreground/50">
              Paste the Payload URL into GitHub → Settings → Webhooks → Add webhook
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepCard({ n, title, description, active, done, children }: {
  n: number;
  title: string;
  description: string;
  active: boolean;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 transition-colors ${
      done
        ? 'border-emerald-500/20 bg-emerald-500/3'
        : active
          ? 'border-purple-500/25 bg-purple-500/5'
          : 'border-border/20 bg-secondary/5 opacity-50'
    }`}>
      <div className="flex items-start gap-3">
        <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${
          done
            ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400'
            : active
              ? 'bg-purple-500/15 border-purple-500/25 text-purple-400'
              : 'bg-muted/20 border-border/30 text-muted-foreground/50'
        }`}>
          {done ? <Check className="w-3 h-3" /> : n}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${done ? 'text-emerald-400/90' : 'text-foreground/90'}`}>{title}</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">{description}</p>
          {(active || done) && children && (
            <div className="mt-3">{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value, onCopy, copied, compact }: {
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'px-3 py-2 rounded-lg bg-background/30 border border-primary/5'}`}>
      <span className={`text-muted-foreground/70 flex-shrink-0 ${compact ? 'text-xs w-24' : 'text-xs w-28 font-medium'}`}>{label}</span>
      <span className={`flex-1 font-mono truncate ${compact ? 'text-xs text-foreground/70' : 'text-sm text-foreground/80'}`}>{value}</span>
      {onCopy && (
        <button onClick={onCopy} className="p-1 rounded text-foreground/50 hover:text-foreground transition-colors flex-shrink-0">
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      )}
    </div>
  );
}
