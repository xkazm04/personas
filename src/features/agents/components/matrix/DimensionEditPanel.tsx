/**
 * Post-build dimension editing panels for the creation flow.
 *
 * Each dimension gets a purpose-built editor that works with buildCellData.raw:
 * - Tasks, Messages, Memory, Errors, Events → SimpleListEditor (add/remove items)
 * - Connectors → ConnectorCards (status dots, credential link, swap alternatives)
 * - Triggers → TriggerCards (type badge, config, inline editing)
 * - Human Review → ReviewToggle (required/not + description)
 */
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Plus, X, ArrowLeftRight, Clock, Webhook, Radio, MousePointerClick, Activity,
  KeyRound, ExternalLink, Check, AlertTriangle,
} from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { useClickOutside } from "@/hooks/utility/interaction/useClickOutside";
import { matchCredentialToConnector } from "@/features/templates/sub_n8n/edit/connectorMatching";

// ---------------------------------------------------------------------------
// SimpleListEditor — for tasks, messages, memory, errors, events
// ---------------------------------------------------------------------------

interface SimpleListEditorProps {
  cellKey: string;
  items: string[];
  onItemsChange: (items: string[]) => void;
  placeholder?: string;
  readOnly?: boolean;
}

function SimpleListEditor({ items, onItemsChange, placeholder = "Add item...", readOnly }: SimpleListEditorProps) {
  const [newItem, setNewItem] = useState("");

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    onItemsChange([...items, trimmed]);
    setNewItem("");
  };

  const handleRemove = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1.5 w-full">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 group min-h-[24px]">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/30 mt-[7px] flex-shrink-0" />
          <span className="text-[12px] text-foreground/70 leading-snug flex-1">{item}</span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => handleRemove(i)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground/30 hover:text-red-400 transition-all flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex gap-1.5 mt-1">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            placeholder={placeholder}
            className="flex-1 px-2 py-1 rounded border border-primary/10 bg-transparent text-[11px] text-foreground/70 placeholder-muted-foreground/25 focus:outline-none focus:border-primary/30"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newItem.trim()}
            className="p-1 rounded text-primary/50 hover:text-primary disabled:text-muted-foreground/15 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectorCards — structured connector display with swap + credential link
// ---------------------------------------------------------------------------

interface ConnectorCardData {
  name: string;
  service_type?: string;
  purpose?: string;
  has_credential?: boolean;
}

/** Determine real credential status for a connector by checking vault credentials + health. */
function getConnectorStatus(
  connectorName: string,
  credentials: unknown[],
  buildLinks: Record<string, string>,
): { found: boolean; healthy: boolean | null; credName: string | null } {
  const creds = credentials as Array<Record<string, unknown>>;
  // Check explicit build link first
  const linkedId = buildLinks[connectorName];
  if (linkedId) {
    const cred = creds.find((c) => c.id === linkedId);
    if (cred) return { found: true, healthy: (cred.healthcheck_last_success as boolean | null) ?? null, credName: cred.name as string };
  }
  // Auto-match by service_type
  const match = matchCredentialToConnector(credentials as Parameters<typeof matchCredentialToConnector>[0], connectorName);
  if (match) {
    const m = match as unknown as Record<string, unknown>;
    return { found: true, healthy: (m.healthcheck_last_success as boolean | null) ?? null, credName: m.name as string };
  }
  return { found: false, healthy: null, credName: null };
}

/** Check if all connectors in the cell have healthy credentials. Exported for cell state override. */
export function checkConnectorsHealth(
  connectors: ConnectorCardData[],
  credentials: unknown[],
  buildLinks: Record<string, string>,
): { allHealthy: boolean; unhealthyNames: string[] } {
  const unhealthy: string[] = [];
  for (const c of connectors) {
    const status = getConnectorStatus(c.name, credentials, buildLinks);
    if (!status.found || status.healthy !== true) {
      unhealthy.push(c.name);
    }
  }
  return { allHealthy: unhealthy.length === 0, unhealthyNames: unhealthy };
}

// ---------------------------------------------------------------------------
// ConnectorSwapModal — full-screen modal showing ALL healthy user credentials
// ---------------------------------------------------------------------------

function ConnectorSwapModal({ connectorName, onSelect, onClose }: {
  connectorName: string;
  onSelect: (newServiceType: string) => void;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  useClickOutside(modalRef, true, onClose);
  const credentials = useVaultStore((s) => s.credentials) ?? [];

  // Get all credentials with healthy status (healthcheck_last_success === true)
  // plus untested ones (null) as they might work
  const healthyCredentials = credentials.filter((cred) => {
    const health = (cred as unknown as Record<string, unknown>).healthcheck_last_success;
    return health === true || health === null;
  });

  // Group by service_type for cleaner display
  const grouped = new Map<string, typeof healthyCredentials>();
  for (const cred of healthyCredentials) {
    const type = cred.service_type;
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type)!.push(cred);
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
      <div
        ref={modalRef}
        className="w-full max-w-lg max-h-[70vh] flex flex-col rounded-2xl border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-primary/10 bg-primary/[0.03]">
          <div>
            <h2 className="text-sm font-semibold text-foreground/90">Replace: {connectorName}</h2>
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">Choose from your connected services with healthy credentials</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4 text-muted-foreground/60" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {healthyCredentials.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground/50">No healthy credentials found.</p>
              <p className="text-[11px] text-muted-foreground/30 mt-1">Add credentials in the Keys module and run health checks.</p>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([serviceType, creds]) => (
              <div key={serviceType}>
                <h3 className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider mb-1.5">{serviceType}</h3>
                <div className="space-y-1">
                  {creds.map((cred) => {
                    const health = (cred as unknown as Record<string, unknown>).healthcheck_last_success;
                    return (
                      <button
                        key={cred.id}
                        type="button"
                        onClick={() => {
                          onSelect(cred.service_type);
                          onClose();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-primary/10 bg-primary/[0.02] hover:bg-primary/10 hover:border-primary/20 transition-colors text-left"
                      >
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${health === true ? "bg-emerald-400" : "bg-amber-400"}`} />
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-medium text-foreground/80">{cred.name}</span>
                          <p className="text-[10px] text-muted-foreground/40">{cred.service_type}</p>
                        </div>
                        <ArrowLeftRight className="w-3.5 h-3.5 text-primary/30 flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// ConnectorCards — structured connector display with health + modal swap
// ---------------------------------------------------------------------------

function ConnectorCards({ connectors, onSwap }: {
  connectors: ConnectorCardData[];
  onSwap?: (oldName: string, newName: string) => void;
}) {
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  const credentials = useVaultStore((s) => s.credentials) ?? [];
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const buildConnectorLinks = useAgentStore((s) => s.buildConnectorLinks);

  // Check overall health
  const { allHealthy } = checkConnectorsHealth(connectors, credentials, buildConnectorLinks);

  return (
    <div className="space-y-1.5 w-full">
      {!allHealthy && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/8 border border-amber-500/15 text-[10px] text-amber-400/80">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          Some connectors need healthy credentials before this dimension can be finalized
        </div>
      )}

      {connectors.map((c) => {
        const status = getConnectorStatus(c.name, credentials, buildConnectorLinks);

        const dotColor = !status.found ? "bg-red-400"
          : status.healthy === true ? "bg-emerald-400"
          : status.healthy === false ? "bg-amber-400"
          : "bg-amber-400";

        return (
          <div key={c.name} className="rounded-lg border border-primary/10 bg-primary/[0.02] p-2">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-medium text-foreground/80">{c.name}</span>
                {c.purpose && (
                  <p className="text-[10px] text-muted-foreground/50 truncate">{c.purpose}</p>
                )}
              </div>

              {/* Replace button — opens modal with all healthy credentials */}
              <button
                type="button"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-primary/40 hover:text-primary hover:bg-primary/10 transition-colors"
                onClick={() => setSwapTarget(c.name)}
              >
                <ArrowLeftRight className="w-3 h-3" />
                Replace
              </button>
            </div>

            {/* Credential health status */}
            <div className="mt-1 pl-4">
              {status.found ? (
                <span className={`text-[10px] flex items-center gap-1 ${
                  status.healthy === true ? "text-emerald-400/70" :
                  status.healthy === false ? "text-amber-400/70" :
                  "text-amber-400/70"
                }`}>
                  <Check className="w-2.5 h-2.5" />
                  {status.credName}
                  {status.healthy === true && " — healthy"}
                  {status.healthy === false && " — check failed"}
                  {status.healthy === null && " — not tested"}
                </span>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1 text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                  onClick={() => setSidebarSection("credentials")}
                >
                  <KeyRound className="w-2.5 h-2.5" />
                  <span>Add credential in Keys</span>
                  <ExternalLink className="w-2 h-2" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Swap modal */}
      {swapTarget && (
        <ConnectorSwapModal
          connectorName={swapTarget}
          onSelect={(newServiceType) => onSwap?.(swapTarget, newServiceType)}
          onClose={() => setSwapTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TriggerCards — structured trigger display with type badge + config
// ---------------------------------------------------------------------------

interface TriggerCardData {
  trigger_type: string;
  config?: Record<string, string>;
  description?: string;
}

const TRIGGER_ICONS: Record<string, typeof Clock> = {
  schedule: Clock,
  polling: Radio,
  webhook: Webhook,
  manual: MousePointerClick,
  event: Activity,
};

const TRIGGER_COLORS: Record<string, string> = {
  schedule: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  polling: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  webhook: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  manual: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  event: "text-teal-400 bg-teal-500/10 border-teal-500/20",
};

function TriggerCards({ triggers, onConfigChange }: {
  triggers: TriggerCardData[];
  onConfigChange?: (index: number, config: Record<string, string>) => void;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  return (
    <div className="space-y-1.5 w-full">
      {triggers.map((t, i) => {
        const Icon = TRIGGER_ICONS[t.trigger_type] ?? Activity;
        const colorClass = TRIGGER_COLORS[t.trigger_type] ?? "text-foreground/50 bg-secondary/20 border-secondary/30";
        const isEditing = editingIdx === i;
        const hasCron = t.config?.cron;
        const hasInterval = t.config?.interval;

        return (
          <div key={i} className={`rounded-lg border p-2 ${colorClass}`}>
            <div className="flex items-center gap-2">
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-medium capitalize">{t.trigger_type}</span>
                {t.description && (
                  <p className="text-[10px] opacity-70 truncate">{t.description}</p>
                )}
              </div>
              {(hasCron || hasInterval) && onConfigChange && (
                <button
                  type="button"
                  className="text-[10px] opacity-50 hover:opacity-100 transition-opacity"
                  onClick={() => setEditingIdx(isEditing ? null : i)}
                >
                  {isEditing ? "Done" : "Edit"}
                </button>
              )}
            </div>

            {/* Config summary */}
            {hasCron && !isEditing && (
              <p className="mt-1 pl-[22px] text-[10px] opacity-60 font-mono">{t.config!.cron}</p>
            )}

            {/* Inline config editor */}
            {isEditing && (
              <div className="mt-1.5 pl-[22px] space-y-1">
                {hasCron && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] opacity-50 w-12">Cron:</span>
                    <input
                      type="text"
                      defaultValue={t.config!.cron}
                      className="flex-1 px-1.5 py-0.5 rounded border border-current/20 bg-transparent text-[10px] font-mono focus:outline-none"
                      onBlur={(e) => onConfigChange?.(i, { ...t.config, cron: e.target.value })}
                    />
                  </div>
                )}
                {hasInterval && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] opacity-50 w-12">Every:</span>
                    <input
                      type="text"
                      defaultValue={t.config!.interval}
                      className="flex-1 px-1.5 py-0.5 rounded border border-current/20 bg-transparent text-[10px] focus:outline-none"
                      onBlur={(e) => onConfigChange?.(i, { ...t.config, interval: e.target.value })}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewToggle — human review required/not toggle + items
// ---------------------------------------------------------------------------

function ReviewToggle({ items, onItemsChange }: {
  items: string[];
  onItemsChange: (items: string[]) => void;
}) {
  const hasApproval = items.some(
    (item) => item.toLowerCase().includes("required") && !item.toLowerCase().includes("not required"),
  );

  const toggleApproval = () => {
    if (hasApproval) {
      onItemsChange(["Not required — all actions are automated"]);
    } else {
      onItemsChange([
        "Required before any external action (sending, posting, modifying)",
        "Not required for read-only operations",
      ]);
    }
  };

  return (
    <div className="space-y-2 w-full">
      <button
        type="button"
        onClick={toggleApproval}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors w-full ${
          hasApproval
            ? "border-rose-400/30 bg-rose-500/10 text-rose-400"
            : "border-emerald-400/30 bg-emerald-500/10 text-emerald-400"
        }`}
      >
        <span className={`w-2.5 h-2.5 rounded-full ${hasApproval ? "bg-rose-400" : "bg-emerald-400"}`} />
        {hasApproval ? "Approval Required" : "Fully Automated"}
      </button>
      <SimpleListEditor cellKey="human-review" items={items} onItemsChange={onItemsChange} placeholder="Add review rule..." />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DimensionEditPanel — routes to the right editor based on cell key
// ---------------------------------------------------------------------------

interface DimensionEditPanelProps {
  cellKey: string;
  onDirty: () => void;
}

export function DimensionEditPanel({ cellKey, onDirty }: DimensionEditPanelProps) {
  const cellData = useAgentStore((s) => s.buildCellData[cellKey]);
  const items = cellData?.items ?? [];
  const raw = cellData?.raw;

  const updateItems = (newItems: string[]) => {
    useAgentStore.setState((s) => ({
      buildCellData: {
        ...s.buildCellData,
        [cellKey]: { ...s.buildCellData[cellKey], items: newItems },
      },
    }));
    onDirty();
  };

  // Connectors — structured cards with modal swap
  if (cellKey === "connectors") {
    const connectors: ConnectorCardData[] = Array.isArray(raw?.connectors)
      ? (raw.connectors as ConnectorCardData[])
      : [];

    if (connectors.length === 0) {
      return <SimpleListEditor cellKey={cellKey} items={items} onItemsChange={updateItems} placeholder="Add connector..." />;
    }

    return (
      <ConnectorCards
        connectors={connectors}
        onSwap={(oldName, newName) => {
          // Update the connector in raw data
          const newConnectors = connectors.map((c) =>
            c.name === oldName ? { ...c, name: newName, has_credential: false } : c,
          );
          const newItems = items.map((item) =>
            item.toLowerCase().includes(oldName.toLowerCase())
              ? item.replace(new RegExp(oldName, "gi"), newName)
              : item,
          );
          useAgentStore.setState((s) => ({
            buildCellData: {
              ...s.buildCellData,
              connectors: {
                ...s.buildCellData.connectors,
                items: newItems,
                raw: { ...raw, connectors: newConnectors },
              },
            },
          }));
          onDirty();
        }}
      />
    );
  }

  // Triggers — structured cards
  if (cellKey === "triggers") {
    const triggers: TriggerCardData[] = Array.isArray(raw?.triggers)
      ? (raw.triggers as TriggerCardData[])
      : [];

    if (triggers.length === 0) {
      return <SimpleListEditor cellKey={cellKey} items={items} onItemsChange={updateItems} placeholder="Add trigger..." />;
    }

    return (
      <TriggerCards
        triggers={triggers}
        onConfigChange={(index, config) => {
          const newTriggers = triggers.map((t, i) => (i === index ? { ...t, config } : t));
          useAgentStore.setState((s) => ({
            buildCellData: {
              ...s.buildCellData,
              triggers: {
                ...s.buildCellData.triggers,
                raw: { ...raw, triggers: newTriggers },
              },
            },
          }));
          onDirty();
        }}
      />
    );
  }

  // Human Review — toggle + list
  if (cellKey === "human-review") {
    return <ReviewToggle items={items} onItemsChange={updateItems} />;
  }

  // Events — read-only list
  if (cellKey === "events") {
    return <SimpleListEditor cellKey={cellKey} items={items} onItemsChange={updateItems} readOnly />;
  }

  // Default: simple list editor (tasks, messages, memory, errors)
  const placeholders: Record<string, string> = {
    "use-cases": "Add task...",
    messages: "Add notification channel...",
    memory: "Add memory item...",
    "error-handling": "Add error strategy...",
  };

  return (
    <SimpleListEditor
      cellKey={cellKey}
      items={items}
      onItemsChange={updateItems}
      placeholder={placeholders[cellKey] ?? "Add item..."}
    />
  );
}
