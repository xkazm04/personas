import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, ArrowRight, Monitor } from 'lucide-react';
import { useVaultStore } from "@/stores/vaultStore";
import type { ConnectorDefinition } from '@/lib/types/types';
import { staggerContainer, staggerItem } from '@/features/templates/animationPresets';
import { isDesktopBridge } from '@/lib/utils/platform/connectors';
import { useTranslation } from '@/i18n/useTranslation';

interface WizardServiceSelectProps {
  onSelect: (connector: ConnectorDefinition) => void;
}

export function WizardServiceSelect({ onSelect }: WizardServiceSelectProps) {
  const { t, tx } = useTranslation();
  const wd = t.vault.wizard_detect;
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const [search, setSearch] = useState('');

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

  const grouped = useMemo(() => {
    const map = new Map<string, ConnectorDefinition[]>();
    for (const c of filtered) {
      const cat = c.category || 'Other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="typo-heading-lg font-bold text-foreground tracking-tight">
          {wd.choose_service}
        </h2>
        <p className="typo-body text-foreground mt-1">
          {wd.ai_walk_description}
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={wd.search_services}
          autoFocus
          className="w-full pl-9 pr-4 py-2.5 rounded-modal border border-primary/15 bg-secondary/25 typo-body text-foreground placeholder-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 transition-all"
        />
      </div>

      {/* Service grid */}
      <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1 -mr-1">
        {grouped.map(([category, connectors]) => (
          <div key={category}>
            <h3 className="typo-body font-medium text-foreground uppercase tracking-wider mb-2">
              {category}
            </h3>
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
            >
              {connectors.map((connector) => (
                <motion.button
                  key={connector.id}
                  variants={staggerItem}
                  onClick={() => onSelect(connector)}
                  className="group flex items-center gap-3 px-3.5 py-3 rounded-modal border border-primary/10 bg-secondary/20 hover:bg-violet-500/10 hover:border-violet-500/25 transition-all text-left"
                >
                  <div
                    className="w-8 h-8 rounded-card flex items-center justify-center shrink-0 typo-heading font-bold"
                    style={{
                      backgroundColor: `${connector.color}15`,
                      color: connector.color,
                      border: `1px solid ${connector.color}30`,
                    }}
                  >
                    {connector.label.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="typo-body font-medium text-foreground/90 group-hover:text-foreground block truncate">
                      {connector.label}
                      {isDesktopBridge(connector) && (
                        <span className="inline-flex items-center gap-0.5 ml-1.5 px-1 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20 align-middle">
                          <Monitor className="w-2.5 h-2.5" />
                          Local
                        </span>
                      )}
                    </span>
                    <span className="typo-body text-foreground block truncate">
                      {isDesktopBridge(connector)
                        ? wd.desktop_bridge
                        : `${connector.fields.length} field${connector.fields.length !== 1 ? 's' : ''} required`}
                    </span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-foreground group-hover:text-violet-400 transition-colors shrink-0" />
                </motion.button>
              ))}
            </motion.div>
          </div>
        ))}

        {grouped.length === 0 && (
          <div className="text-center py-10">
            <p className="typo-body text-foreground">{tx(wd.no_services, { search })}</p>
          </div>
        )}
      </div>
    </div>
  );
}
