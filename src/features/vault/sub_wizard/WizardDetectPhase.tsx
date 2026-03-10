import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
<<<<<<< HEAD
import { Search, Radar, CheckCircle2, Loader2, Sparkles, Monitor } from 'lucide-react';
=======
import { Search, Radar, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
import { usePersonaStore } from '@/stores/personaStore';
import { ThemedConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { detectAuthenticatedServices, type AuthDetection } from '@/api/authDetect';
import type { ConnectorDefinition } from '@/lib/types/types';
import { staggerContainer, staggerItem } from '@/features/templates/animationPresets';
<<<<<<< HEAD
import { isDesktopBridge } from '@/lib/utils/connectors';
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

interface WizardDetectPhaseProps {
  onSelect: (connectors: ConnectorDefinition[]) => void;
}

export function WizardDetectPhase({ onSelect }: WizardDetectPhaseProps) {
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const existingCredentials = usePersonaStore((s) => s.credentials);

  const [search, setSearch] = useState('');
  const [detections, setDetections] = useState<AuthDetection[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasDetected, setHasDetected] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Already-added service types
  const addedServiceTypes = useMemo(
    () => new Set(existingCredentials.map((c) => c.service_type)),
    [existingCredentials],
  );

  // Run auth detection on user click
  const handleDetect = useCallback(async () => {
    setIsDetecting(true);
    try {
      const results = await detectAuthenticatedServices();
      setDetections(results);
      // Auto-select detected services that aren't already added
      const autoSelect = new Set<string>();
      for (const d of results) {
        if (d.authenticated && !addedServiceTypes.has(d.service_type)) {
          autoSelect.add(d.service_type);
        }
      }
      setSelected((prev) => {
        const next = new Set(prev);
        for (const s of autoSelect) next.add(s);
        return next;
      });
    } catch {
      // Detection failed silently — user can still manually select
    } finally {
      setIsDetecting(false);
      setHasDetected(true);
    }
  }, [addedServiceTypes]);

  // Build detection map: service_type → AuthDetection
  const detectionMap = useMemo(() => {
    const map = new Map<string, AuthDetection>();
    for (const d of detections) {
      if (d.authenticated) map.set(d.service_type, d);
    }
    return map;
  }, [detections]);

  // Filter connectors by search
  const filtered = useMemo(() => {
    if (!search.trim()) return connectorDefinitions;
    const q = search.toLowerCase();
    return connectorDefinitions.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [connectorDefinitions, search]);

  // Split connectors into detected / available / already-added
  const { detected, available, alreadyAdded } = useMemo(() => {
    const det: ConnectorDefinition[] = [];
    const avail: ConnectorDefinition[] = [];
    const added: ConnectorDefinition[] = [];

    for (const c of filtered) {
      if (addedServiceTypes.has(c.name)) {
        added.push(c);
      } else if (detectionMap.has(c.name)) {
        det.push(c);
      } else {
        avail.push(c);
      }
    }

    return { detected: det, available: avail, alreadyAdded: added };
  }, [filtered, addedServiceTypes, detectionMap]);

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleSetup = useCallback(() => {
    const connectors = connectorDefinitions.filter((c) => selected.has(c.name));
    if (connectors.length > 0) {
      onSelect(connectors);
    }
  }, [selected, connectorDefinitions, onSelect]);

  const renderConnectorRow = (connector: ConnectorDefinition, isAdded: boolean) => {
    const detection = detectionMap.get(connector.name);
    const isSelected = selected.has(connector.name);

    return (
      <motion.button
        key={connector.id}
        variants={staggerItem}
        onClick={() => {
          if (isAdded) return;
          toggleSelect(connector.name);
        }}
        disabled={isAdded}
        className={`group flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all text-left ${
          isAdded
            ? 'border-primary/5 bg-secondary/10 opacity-40 cursor-not-allowed'
            : isSelected
              ? 'border-violet-500/30 bg-violet-500/10'
              : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20'
        }`}
      >
        {/* Checkbox */}
        {!isAdded && (
          <div
            className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
              isSelected
                ? 'bg-violet-500 border-violet-500'
                : 'border-primary/20'
            }`}
          >
            {isSelected && (
              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}

        {/* Icon */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold"
          style={{
            backgroundColor: `${connector.color}15`,
            color: connector.color,
            border: `1px solid ${connector.color}30`,
          }}
        >
          {connector.icon_url ? (
            <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-4 h-4" />
          ) : (
            connector.label.charAt(0).toUpperCase()
          )}
        </div>

        {/* Label + detection badge */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground/90 block truncate">
            {connector.label}
          </span>
          <span className="text-sm text-muted-foreground/60 block truncate">
            {isAdded
              ? 'Already added'
              : detection
                ? detection.identity ?? `Detected via ${detection.method}`
                : `${connector.fields.length} field${connector.fields.length !== 1 ? 's' : ''}`}
          </span>
        </div>

<<<<<<< HEAD
        {/* Desktop bridge badge */}
        {isDesktopBridge(connector) && !isAdded && (
          <span className="flex items-center gap-1 text-sm px-1.5 py-0.5 rounded-full shrink-0 bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <Monitor className="w-2.5 h-2.5" />
            Local
          </span>
        )}

=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
        {/* Detection badge */}
        {detection && !isAdded && (
          <span className={`text-sm px-1.5 py-0.5 rounded-full shrink-0 ${
            detection.confidence === 'high'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
          }`}>
            {detection.method === 'cli' ? 'CLI auth' : 'Session'}
          </span>
        )}

        {isAdded && (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/40 shrink-0" />
        )}
      </motion.button>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-foreground tracking-tight">
          Set up credentials
        </h2>
        <p className="text-sm text-muted-foreground/80 mt-1">
          {hasDetected && detected.length > 0
            ? `Found ${detected.length} service${detected.length !== 1 ? 's' : ''} you're signed into. Select which to add.`
            : 'Select services to add credentials for, or scan to auto-detect.'}
        </p>
      </div>

      {/* Scan button */}
      {!hasDetected && (
        <button
          onClick={handleDetect}
          disabled={isDetecting}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-cyan-500/10 hover:bg-cyan-500/15 border border-cyan-500/20 rounded-xl text-sm font-medium text-cyan-300 transition-colors disabled:opacity-60"
        >
          {isDetecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Scanning CLI tools and browser sessions...
            </>
          ) : (
            <>
              <Radar className="w-4 h-4" />
              Scan for authenticated services
            </>
          )}
        </button>
      )}

      {/* Detection results banner */}
      {hasDetected && detected.length === 0 && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-secondary/30 border border-primary/10 rounded-xl">
          <Radar className="w-4 h-4 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground/70">No authenticated services detected. Select manually below.</p>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/90" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-violet-500/30 transition-all"
        />
      </div>

      {/* Connector grid */}
      <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1 -mr-1">
        {/* Detected services */}
        {detected.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-emerald-400/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              Detected ({detected.length})
            </h3>
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
<<<<<<< HEAD
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
=======
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
            >
              {detected.map((c) => renderConnectorRow(c, false))}
            </motion.div>
          </div>
        )}

        {/* Available services */}
        {available.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
              Available ({available.length})
            </h3>
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
<<<<<<< HEAD
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
=======
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
            >
              {available.map((c) => renderConnectorRow(c, false))}
            </motion.div>
          </div>
        )}

        {/* Already added */}
        {alreadyAdded.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">
              Already added ({alreadyAdded.length})
            </h3>
<<<<<<< HEAD
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
=======
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
              {alreadyAdded.map((c) => renderConnectorRow(c, true))}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-muted-foreground/60">No services match "{search}"</p>
          </div>
        )}
      </div>

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between pt-2 border-t border-primary/10">
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-muted-foreground/60 hover:text-foreground/80 transition-colors"
          >
            Clear selection
          </button>
          <button
            onClick={handleSetup}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-300 rounded-xl text-sm font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Set up {selected.size} service{selected.size !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );
}
