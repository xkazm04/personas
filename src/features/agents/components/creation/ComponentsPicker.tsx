import { useState, useMemo } from 'react';
import { Plus, X, Search, Plug, Key } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import type { BuilderComponent } from './types';

interface ComponentsPickerProps {
  components: BuilderComponent[];
  onAdd: (connectorName: string) => void;
  onRemove: (connectorName: string) => void;
  onSetCredential: (connectorName: string, credentialId: string | null) => void;
}

// ── Modal backdrop ──────────────────────────────────────────────────

function ModalBackdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15 }}
        className="bg-background border border-primary/15 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

// ── Add Component Modal ─────────────────────────────────────────────

function AddComponentModal({
  onAdd,
  onClose,
  selectedSet,
}: {
  onAdd: (name: string) => void;
  onClose: () => void;
  selectedSet: Set<string>;
}) {
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return connectorDefinitions
      .filter((c) => !selectedSet.has(c.name))
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.label.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q)
        );
      });
  }, [connectorDefinitions, selectedSet, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const c of filtered) {
      const cat = c.category || 'other';
      (groups[cat] ??= []).push(c);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <ModalBackdrop onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4 text-muted-foreground/60" />
          <h3 className="text-sm font-semibold text-foreground/90">Add Component</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      <div className="relative px-5 pt-3 pb-2">
        <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 mt-[2px]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search connectors..."
          autoFocus
          className="w-full pl-7 pr-3 py-2 bg-secondary/40 border border-primary/10 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
        {connectorDefinitions.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground/50">
            <Plug className="w-5 h-5 mx-auto mb-2 opacity-50" />
            No connectors available
          </div>
        ) : grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground/40 text-center py-6">
            No connectors match &ldquo;{search}&rdquo;
          </p>
        ) : (
          grouped.map(([category, connectors]) => (
            <div key={category}>
              <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-2">
                {category}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {connectors.map((c) => {
                  const meta = getConnectorMeta(c.name);
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => {
                        onAdd(c.name);
                        onClose();
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg border bg-secondary/20 border-primary/8 text-muted-foreground/70 hover:bg-secondary/50 hover:text-foreground/80 hover:border-primary/20 transition-all"
                    >
                      <ConnectorIcon meta={meta} size="w-4 h-4" />
                      <span className="truncate">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </ModalBackdrop>
  );
}

// ── Credential Picker Modal ─────────────────────────────────────────

function CredentialPickerModal({
  connectorName,
  currentCredentialId,
  onSelect,
  onClose,
}: {
  connectorName: string;
  currentCredentialId: string | null;
  onSelect: (credentialId: string | null) => void;
  onClose: () => void;
}) {
  const credentials = usePersonaStore((s) => s.credentials);
  const meta = getConnectorMeta(connectorName);

  // Show ALL credentials so the user can always pick one
  // Sort matching service_type first
  const sorted = useMemo(() => {
    return [...credentials].sort((a, b) => {
      const aMatch = a.service_type.toLowerCase() === connectorName.toLowerCase() ? 0 : 1;
      const bMatch = b.service_type.toLowerCase() === connectorName.toLowerCase() ? 0 : 1;
      return aMatch - bMatch || a.name.localeCompare(b.name);
    });
  }, [credentials, connectorName]);

  return (
    <ModalBackdrop onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <ConnectorIcon meta={meta} size="w-4 h-4" />
          <h3 className="text-sm font-semibold text-foreground/90">
            Assign Credential to {meta.label}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Credential list */}
      <div className="flex-1 overflow-y-auto p-5 space-y-1.5">
        {/* No credential option */}
        <button
          type="button"
          onClick={() => { onSelect(null); onClose(); }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border transition-all ${
            !currentCredentialId
              ? 'bg-primary/10 border-primary/25 text-primary'
              : 'bg-secondary/20 border-primary/8 text-muted-foreground/70 hover:bg-secondary/40'
          }`}
        >
          <X className="w-4 h-4 text-muted-foreground/40" />
          <span>No credential</span>
        </button>

        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground/40 text-center py-4">
            No saved credentials. Add credentials in the Vault first.
          </p>
        ) : (
          sorted.map((cred) => {
            const active = currentCredentialId === cred.id;
            const isMatch = cred.service_type.toLowerCase() === connectorName.toLowerCase();
            return (
              <button
                key={cred.id}
                type="button"
                onClick={() => { onSelect(cred.id); onClose(); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg border transition-all ${
                  active
                    ? 'bg-primary/10 border-primary/25 text-primary'
                    : 'bg-secondary/20 border-primary/8 text-muted-foreground/70 hover:bg-secondary/40'
                }`}
              >
                <Key className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                <div className="flex-1 min-w-0 text-left">
                  <p className="truncate font-medium">{cred.name}</p>
                  <p className="text-[10px] text-muted-foreground/50 truncate">
                    {cred.service_type}
                    {isMatch && <span className="ml-1 text-primary/60">(matches)</span>}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </ModalBackdrop>
  );
}

// ── Component Row ───────────────────────────────────────────────────

function ComponentRow({
  comp,
  onOpenCredentialPicker,
  onRemove,
}: {
  comp: BuilderComponent;
  onOpenCredentialPicker: () => void;
  onRemove: () => void;
}) {
  const credentials = usePersonaStore((s) => s.credentials);
  const meta = getConnectorMeta(comp.connectorName);
  const credName = comp.credentialId
    ? credentials.find((c) => c.id === comp.credentialId)?.name ?? 'Unknown'
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-secondary/25 border border-primary/10 rounded-lg">
        <ConnectorIcon meta={meta} size="w-4 h-4" />
        <span className="text-xs font-medium text-foreground/80 min-w-0 truncate shrink-0">
          {meta.label}
        </span>

        <button
          type="button"
          onClick={onOpenCredentialPicker}
          className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/30 border border-primary/10 hover:bg-background/50 transition-colors cursor-pointer"
        >
          <Key className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          {credName ? (
            <span className="text-[11px] text-foreground/70 truncate">{credName}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground/40 italic truncate">Assign credential...</span>
          )}
        </button>

        <button
          type="button"
          onClick={onRemove}
          className="p-0.5 text-muted-foreground/30 hover:text-red-400 transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function ComponentsPicker({ components, onAdd, onRemove, onSetCredential }: ComponentsPickerProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [credPickerFor, setCredPickerFor] = useState<string | null>(null);

  const selectedSet = useMemo(
    () => new Set(components.map((c) => c.connectorName)),
    [components],
  );

  const credPickerComp = credPickerFor
    ? components.find((c) => c.connectorName === credPickerFor)
    : null;

  return (
    <div className="space-y-2">
      {/* Selected components list */}
      <AnimatePresence mode="popLayout">
        {components.map((comp) => (
          <ComponentRow
            key={comp.connectorName}
            comp={comp}
            onOpenCredentialPicker={() => setCredPickerFor(comp.connectorName)}
            onRemove={() => onRemove(comp.connectorName)}
          />
        ))}
      </AnimatePresence>

      {/* Add component button */}
      <button
        type="button"
        onClick={() => setShowAddModal(true)}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground/60 border border-dashed border-primary/15 rounded-lg hover:bg-secondary/30 hover:text-foreground/70 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add component
      </button>

      {/* Add Component Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddComponentModal
            onAdd={(name) => {
              onAdd(name);
              setShowAddModal(false);
            }}
            onClose={() => setShowAddModal(false)}
            selectedSet={selectedSet}
          />
        )}
      </AnimatePresence>

      {/* Credential Picker Modal */}
      <AnimatePresence>
        {credPickerComp && (
          <CredentialPickerModal
            connectorName={credPickerComp.connectorName}
            currentCredentialId={credPickerComp.credentialId}
            onSelect={(credId) => onSetCredential(credPickerComp.connectorName, credId)}
            onClose={() => setCredPickerFor(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
