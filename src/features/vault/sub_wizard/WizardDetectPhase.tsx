import { useState, useMemo, useCallback } from 'react';
import { Search, Radar, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useVaultStore } from "@/stores/vaultStore";
import { detectAuthenticatedServices, type AuthDetection } from '@/api/auth/authDetect';
import type { ConnectorDefinition } from '@/lib/types/types';
import { WizardDetectGrid } from './WizardDetectGrid';

interface WizardDetectPhaseProps {
  onSelect: (connectors: ConnectorDefinition[]) => void;
}

export function WizardDetectPhase({ onSelect }: WizardDetectPhaseProps) {
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const existingCredentials = useVaultStore((s) => s.credentials);

  const [search, setSearch] = useState('');
  const [detections, setDetections] = useState<AuthDetection[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasDetected, setHasDetected] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const addedServiceTypes = useMemo(
    () => new Set(existingCredentials.map((c) => c.service_type)),
    [existingCredentials],
  );

  const handleDetect = useCallback(async () => {
    setIsDetecting(true);
    try {
      const results = await detectAuthenticatedServices();
      setDetections(results);
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
      // Detection failed silently
    } finally {
      setIsDetecting(false);
      setHasDetected(true);
    }
  }, [addedServiceTypes]);

  const detectionMap = useMemo(() => {
    const map = new Map<string, AuthDetection>();
    for (const d of detections) {
      if (d.authenticated) map.set(d.service_type, d);
    }
    return map;
  }, [detections]);

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
        <Button
          variant="accent"
          accentColor="cyan"
          size="md"
          block
          icon={isDetecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
          loading={isDetecting}
          disabled={isDetecting}
          onClick={handleDetect}
        >
          {isDetecting ? 'Scanning CLI tools and browser sessions...' : 'Scan for authenticated services'}
        </Button>
      )}

      {/* Detection results banner */}
      {hasDetected && detected.length === 0 && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-secondary/30 border border-primary/10 rounded-xl">
          <Radar className="w-4 h-4 text-muted-foreground/80" />
          <p className="text-sm text-muted-foreground/80">No authenticated services detected. Select manually below.</p>
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
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 transition-all"
        />
      </div>

      {/* Connector grid */}
      <WizardDetectGrid
        detected={detected}
        available={available}
        alreadyAdded={alreadyAdded}
        filteredCount={filtered.length}
        search={search}
        selected={selected}
        detectionMap={detectionMap}
        onToggle={toggleSelect}
      />

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between pt-2 border-t border-primary/10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            className="text-muted-foreground/80 hover:text-foreground/90"
          >
            Clear selection
          </Button>
          <Button
            variant="accent"
            accentColor="violet"
            size="md"
            icon={<Sparkles className="w-3.5 h-3.5" />}
            onClick={handleSetup}
          >
            Set up {selected.size} service{selected.size !== 1 ? 's' : ''}
          </Button>
        </div>
      )}
    </div>
  );
}
