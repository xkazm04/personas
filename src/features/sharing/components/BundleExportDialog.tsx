import { useEffect, useState } from 'react';
import { Package, Check, AlertTriangle, Lock, Shield, Clipboard, Link2 } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { save } from '@tauri-apps/plugin-dialog';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useToastStore } from '@/stores/toastStore';
import type { ExposedResource } from '@/api/network/exposure';
import type { EnclavePolicy } from '@/api/network/enclave';
import type { Persona } from '@/lib/bindings/Persona';
import { createLogger } from "@/lib/log";
import { errMsg } from "@/stores/storeTypes";
import { useTranslation } from '@/i18n/useTranslation';

const logger = createLogger("bundle-export");

type ExportMode = 'bundle' | 'enclave';

interface BundleExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BundleExportDialog({ isOpen, onClose }: BundleExportDialogProps) {
  const exposedResources = useSystemStore((s) => s.exposedResources);
  const fetchExposedResources = useSystemStore((s) => s.fetchExposedResources);
  const exportBundle = useSystemStore((s) => s.exportBundle);
  const exportBundleToClipboard = useSystemStore((s) => s.exportBundleToClipboard);
  const createShareLink = useSystemStore((s) => s.createShareLink);
  const sealEnclave = useSystemStore((s) => s.sealEnclave);
  const addToast = useToastStore((s) => s.addToast);
  const personas = useAgentStore((s) => s.personas);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);

  const { t, tx } = useTranslation();
  const st = t.sharing;
  const [mode, setMode] = useState<ExportMode>('bundle');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  // Enclave-specific state
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [maxCostUsd, setMaxCostUsd] = useState('1.00');
  const [maxTurns, setMaxTurns] = useState('10');
  const [allowPersistence, setAllowPersistence] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelected(new Set());
      setExporting(false);
      setCopying(false);
      setCopied(false);
      setCreatingLink(false);
      setLinkCopied(false);
      setLoading(true);
      setSelectedPersonaId('');
      setMaxCostUsd('1.00');
      setMaxTurns('10');
      setAllowPersistence(false);
      Promise.all([
        fetchExposedResources(),
        fetchPersonas(),
      ]).finally(() => setLoading(false));
    }
  }, [isOpen]);

  const toggleResource = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === exposedResources.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(exposedResources.map((r) => r.id)));
    }
  };

  const handleExportBundle = async () => {
    if (selected.size === 0) return;

    try {
      const savePath = await save({
        defaultPath: 'personas-bundle.persona',
        filters: [{ name: 'Persona Bundle', extensions: ['persona'] }],
      });
      if (!savePath) return;

      setExporting(true);
      const result = await exportBundle(Array.from(selected), savePath);
      addToast(`Bundle exported: ${result.resource_count} resource${result.resource_count !== 1 ? 's' : ''} (${formatBytes(result.byte_size)})`, 'success');
      onClose();
    } catch (err) {
      const msg = errMsg(err, 'Failed to export bundle');
      logger.warn('Failed to export bundle', { selectedCount: selected.size, error: msg });
      addToast(`Failed to export bundle: ${msg}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleCopyToClipboard = async () => {
    if (selected.size === 0) return;

    try {
      setCopying(true);
      const result = await exportBundleToClipboard(Array.from(selected));
      await navigator.clipboard.writeText(result.base64);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      addToast(`Bundle copied: ${result.resource_count} resource${result.resource_count !== 1 ? 's' : ''} (${formatBytes(result.byte_size)})`, 'success');
    } catch (err) {
      const msg = errMsg(err, 'Failed to copy bundle');
      logger.warn('Failed to copy bundle to clipboard', { selectedCount: selected.size, error: msg });
      addToast(`Failed to copy bundle: ${msg}`, 'error');
    } finally {
      setCopying(false);
    }
  };

  const handleCreateShareLink = async () => {
    if (selected.size === 0) return;

    try {
      setCreatingLink(true);
      const result = await createShareLink(Array.from(selected));
      await navigator.clipboard.writeText(result.deep_link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
      addToast(`Share link copied! ${result.resource_count} resource${result.resource_count !== 1 ? 's' : ''} (expires in 24h, single use)`, 'success');
    } catch (err) {
      const msg = errMsg(err, 'Failed to create share link');
      logger.warn('Failed to create share link', { selectedCount: selected.size, error: msg });
      addToast(`Failed to create share link: ${msg}`, 'error');
    } finally {
      setCreatingLink(false);
    }
  };

  const handleSealEnclave = async () => {
    if (!selectedPersonaId) return;

    try {
      const savePath = await save({
        defaultPath: 'persona-enclave.enclave',
        filters: [{ name: 'Persona Enclave', extensions: ['enclave'] }],
      });
      if (!savePath) return;

      const policy: EnclavePolicy = {
        maxCostUsd: parseFloat(maxCostUsd) || 1.0,
        maxTurns: parseInt(maxTurns, 10) || 10,
        allowedTools: [],
        allowedDomains: [],
        requiredCapabilities: [],
        allowPersistence,
      };

      setExporting(true);
      const result = await sealEnclave(selectedPersonaId, policy, savePath);
      addToast(`Enclave sealed: "${result.personaName}" (${formatBytes(result.byteSize)})`, 'success');
      onClose();
    } catch (err) {
      const msg = errMsg(err, 'Failed to seal enclave');
      logger.warn('Failed to seal enclave', { personaId: selectedPersonaId, error: msg });
      addToast(`Failed to seal enclave: ${msg}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="bundle-export-title" maxWidthClass="max-w-lg">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="bundle-export-title" className="text-base font-semibold text-foreground flex items-center gap-2">
            {mode === 'enclave' ? (
              <Lock className="w-4.5 h-4.5 text-violet-400" />
            ) : (
              <Package className="w-4.5 h-4.5 text-cyan-400" />
            )}
            {mode === 'enclave' ? st.seal_enclave_title : st.export_title}
          </h2>
          <p className="text-xs text-foreground mt-1">
            {mode === 'enclave'
              ? st.seal_enclave_subtitle
              : st.export_subtitle}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-card border border-border p-0.5 bg-secondary/20">
          <button
            onClick={() => setMode('bundle')}
            className={`flex-1 px-3 py-1.5 text-xs rounded-input transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'bundle'
                ? 'bg-background text-foreground shadow-elevation-1'
                : 'text-foreground hover:text-foreground'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            {st.mode_bundle}
          </button>
          <button
            onClick={() => setMode('enclave')}
            className={`flex-1 px-3 py-1.5 text-xs rounded-input transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'enclave'
                ? 'bg-background text-foreground shadow-elevation-1'
                : 'text-foreground hover:text-foreground'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            {st.mode_enclave}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-foreground py-6 justify-center">
            <LoadingSpinner />
            {t.common.loading}
          </div>
        ) : mode === 'bundle' ? (
          /* Bundle mode */
          exposedResources.length === 0 ? (
            <div className="rounded-modal border border-dashed border-border p-6 text-center text-sm text-foreground">
              <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-400" />
              {st.no_resources_exposed}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button
                  onClick={toggleAll}
                  className="text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  {selected.size === exposedResources.length ? st.deselect_all : st.select_all}
                </button>
                <span className="text-xs text-foreground">
                  {tx(st.selected_of_total, { selected: selected.size, total: exposedResources.length })}
                </span>
              </div>

              <div className="max-h-[40vh] overflow-y-auto space-y-1.5 pr-1">
                {exposedResources.map((resource) => (
                  <ResourceCheckItem
                    key={resource.id}
                    resource={resource}
                    checked={selected.has(resource.id)}
                    onToggle={() => toggleResource(resource.id)}
                  />
                ))}
              </div>
            </>
          )
        ) : (
          /* Enclave mode */
          <EnclaveConfigPanel
            personas={personas}
            selectedPersonaId={selectedPersonaId}
            onSelectPersona={setSelectedPersonaId}
            maxCostUsd={maxCostUsd}
            onMaxCostChange={setMaxCostUsd}
            maxTurns={maxTurns}
            onMaxTurnsChange={setMaxTurns}
            allowPersistence={allowPersistence}
            onAllowPersistenceChange={setAllowPersistence}
          />
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-card border border-border hover:bg-secondary/50"
          >
            {st.cancel}
          </button>
          {mode === 'bundle' ? (
            <>
              <button
                onClick={handleCreateShareLink}
                disabled={selected.size === 0 || creatingLink || copying || exporting}
                className="px-3 py-1.5 text-xs rounded-card border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                title="Generate a one-time share link (expires in 24h)"
              >
                {creatingLink ? <LoadingSpinner size="sm" /> : linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
                {creatingLink ? st.creating_link : linkCopied ? st.link_copied : st.share_link}
              </button>
              <button
                onClick={handleCopyToClipboard}
                disabled={selected.size === 0 || copying || exporting || creatingLink}
                className="px-3 py-1.5 text-xs rounded-card border border-border hover:bg-secondary/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                title="Copy bundle as base64 to clipboard (max 256 KB)"
              >
                {copying ? <LoadingSpinner size="sm" /> : copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Clipboard className="w-3.5 h-3.5" />}
                {copying ? st.copying : copied ? st.copied : st.copy_to_clipboard}
              </button>
              <button
                onClick={handleExportBundle}
                disabled={selected.size === 0 || exporting || copying || creatingLink}
                className="px-3 py-1.5 text-xs rounded-card bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {exporting ? <LoadingSpinner size="sm" /> : <Package className="w-3.5 h-3.5" />}
                {exporting ? st.exporting : st.export_to_file}
              </button>
            </>
          ) : (
            <button
              onClick={handleSealEnclave}
              disabled={!selectedPersonaId || exporting}
              className="px-3 py-1.5 text-xs rounded-card bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {exporting ? <LoadingSpinner size="sm" /> : <Lock className="w-3.5 h-3.5" />}
              {exporting ? st.sealing : st.seal_enclave_btn}
            </button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}

function EnclaveConfigPanel({
  personas,
  selectedPersonaId,
  onSelectPersona,
  maxCostUsd,
  onMaxCostChange,
  maxTurns,
  onMaxTurnsChange,
  allowPersistence,
  onAllowPersistenceChange,
}: {
  personas: Persona[];
  selectedPersonaId: string;
  onSelectPersona: (id: string) => void;
  maxCostUsd: string;
  onMaxCostChange: (v: string) => void;
  maxTurns: string;
  onMaxTurnsChange: (v: string) => void;
  allowPersistence: boolean;
  onAllowPersistenceChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const st = t.sharing;
  return (
    <div className="space-y-3">
      {/* Info banner */}
      <div className="rounded-card border border-violet-500/20 bg-violet-500/5 p-2.5 flex items-start gap-2">
        <Shield className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
        <span className="text-xs text-violet-300/90">
          {st.enclave_info}
        </span>
      </div>

      {/* Persona selector */}
      <div>
        <label className="text-xs text-foreground mb-1 block">{st.label_persona}</label>
        <select
          value={selectedPersonaId}
          onChange={(e) => onSelectPersona(e.target.value)}
          className="w-full px-2.5 py-1.5 text-sm rounded-card border border-border bg-background focus-ring"
        >
          <option value="">{st.select_persona_placeholder}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Policy configuration */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-foreground mb-1 block">{st.label_max_cost}</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={maxCostUsd}
            onChange={(e) => onMaxCostChange(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm rounded-card border border-border bg-background focus-ring"
          />
        </div>
        <div>
          <label className="text-xs text-foreground mb-1 block">{st.label_max_turns}</label>
          <input
            type="number"
            min="1"
            step="1"
            value={maxTurns}
            onChange={(e) => onMaxTurnsChange(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm rounded-card border border-border bg-background focus-ring"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={allowPersistence}
          onChange={(e) => onAllowPersistenceChange(e.target.checked)}
          className="rounded border-border"
        />
        {st.label_allow_persistence}
      </label>
    </div>
  );
}

function ResourceCheckItem({
  resource,
  checked,
  onToggle,
}: {
  resource: ExposedResource;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full rounded-card border p-2.5 flex items-center gap-2.5 text-left transition-colors ${
        checked
          ? 'border-primary/30 bg-primary/5'
          : 'border-border bg-secondary/10 hover:bg-secondary/20'
      }`}
    >
      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
        checked ? 'bg-primary border-primary' : 'border-border'
      }`}>
        {checked && <Check className="w-3 h-3 text-white" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground truncate">
          {resource.display_name || resource.resource_id}
        </div>
        <div className="text-[10px] text-foreground flex items-center gap-1.5">
          <span>{resource.resource_type}</span>
          <span className="text-foreground">·</span>
          <span>{resource.access_level}</span>
        </div>
      </div>
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
