/**
 * Modal dialog for creating a new API key. Captures `name`, `scopes`, and an
 * expiry window, delegating the actual creation to the parent (which calls the
 * Tauri command and surfaces the plaintext via `CreatedKeyDialog`).
 *
 * Capability-token model (see docs/architecture/cloud-integration-bridge.md):
 * `personas:build` / `personas:read` are simple toggles; execution is
 * least-privilege — the user must name each agent, minting one
 * `personas:execute:persona:<id>` scope per pick (no blanket execute). Keys are
 * time-boxed by default.
 */
import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AsyncButton } from '@/features/shared/components/buttons';
import { ExecutePersonaPicker } from './ExecutePersonaPicker';

interface ScopeOption {
  id: string;
  labelKey: 'scope_build' | 'scope_read';
  descriptionKey: 'scope_build_desc' | 'scope_read_desc';
}

const AVAILABLE_SCOPES: ScopeOption[] = [
  { id: 'personas:build', labelKey: 'scope_build', descriptionKey: 'scope_build_desc' },
  { id: 'personas:read', labelKey: 'scope_read', descriptionKey: 'scope_read_desc' },
];

const EXPIRY_OPTIONS: { days: number | null; labelKey: 'expiry_never' | 'expiry_7d' | 'expiry_30d' | 'expiry_90d' }[] = [
  { days: 7, labelKey: 'expiry_7d' },
  { days: 30, labelKey: 'expiry_30d' },
  { days: 90, labelKey: 'expiry_90d' },
  { days: null, labelKey: 'expiry_never' },
];

interface CreateApiKeyDialogProps {
  onSubmit: (name: string, scopes: string[], expiresInDays?: number) => Promise<void>;
  onClose: () => void;
}

export function CreateApiKeyDialog({ onSubmit, onClose }: CreateApiKeyDialogProps) {
  const { t } = useTranslation();
  const s = t.settings.api_keys;

  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(() => new Set(['personas:build']));
  const [allowExecute, setAllowExecute] = useState(false);
  const [executeIds, setExecuteIds] = useState<Set<string>>(() => new Set());
  const [expiresInDays, setExpiresInDays] = useState<number | null>(90);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleScope = useCallback((id: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExecuteId = useCallback((id: string) => {
    setExecuteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const executeScopeCount = allowExecute ? executeIds.size : 0;
  const totalScopeCount = selectedScopes.size + executeScopeCount;

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(s.error_name_required);
      return;
    }
    if (allowExecute && executeIds.size === 0) {
      setError(s.error_execute_persona_required);
      return;
    }
    if (totalScopeCount === 0) {
      setError(s.error_scope_required);
      return;
    }
    const scopes = [
      ...selectedScopes,
      ...(allowExecute ? [...executeIds].map((id) => `personas:execute:persona:${id}`) : []),
    ];
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmedName, scopes, expiresInDays ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }, [name, selectedScopes, allowExecute, executeIds, totalScopeCount, expiresInDays, onSubmit, s]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 surface-blur-modal"
      onClick={onClose}
    >
      <div
        className="bg-secondary border border-border/40 rounded-modal shadow-elevation-3 w-full max-w-md mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <h2 className="typo-body font-medium text-foreground">{s.create_dialog_title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block typo-caption text-foreground mb-1.5">{s.field_name_label}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={s.field_name_placeholder}
              maxLength={64}
              autoFocus
              disabled={submitting}
              className="w-full px-3 py-2 bg-background border border-border/40 rounded-input typo-body text-foreground focus:border-primary/60 focus:outline-none disabled:opacity-50"
            />
            <p className="typo-caption text-foreground mt-1">{s.field_name_hint}</p>
          </div>

          <div>
            <label className="block typo-caption text-foreground mb-1.5">{s.field_scopes_label}</label>
            <div className="space-y-1.5">
              {AVAILABLE_SCOPES.map((scope) => {
                const isSelected = selectedScopes.has(scope.id);
                return (
                  <button
                    key={scope.id}
                    type="button"
                    onClick={() => toggleScope(scope.id)}
                    disabled={submitting}
                    className={`w-full text-left flex items-start gap-2 px-3 py-2 rounded-card border transition-colors disabled:opacity-50 ${
                      isSelected ? 'border-primary/40 bg-primary/10' : 'border-border/30 bg-secondary/30 hover:bg-secondary/50'
                    }`}
                  >
                    <input type="checkbox" checked={isSelected} readOnly className="mt-0.5" tabIndex={-1} />
                    <div className="flex-1 min-w-0">
                      <code className="typo-code text-foreground">{scope.id}</code>
                      <p className="typo-caption text-foreground mt-0.5">{s[scope.descriptionKey]}</p>
                    </div>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setAllowExecute((v) => !v)}
                disabled={submitting}
                className={`w-full text-left flex items-start gap-2 px-3 py-2 rounded-card border transition-colors disabled:opacity-50 ${
                  allowExecute ? 'border-primary/40 bg-primary/10' : 'border-border/30 bg-secondary/30 hover:bg-secondary/50'
                }`}
              >
                <input type="checkbox" checked={allowExecute} readOnly className="mt-0.5" tabIndex={-1} />
                <div className="flex-1 min-w-0">
                  <span className="typo-body text-foreground">{s.scope_execute_label}</span>
                  <p className="typo-caption text-foreground mt-0.5">{s.scope_execute_desc}</p>
                </div>
              </button>
            </div>

            {allowExecute && (
              <div className="mt-2 pl-3 border-l-2 border-primary/30">
                <p className="typo-caption text-foreground mb-1.5">
                  {s.execute_pick_hint} {executeIds.size > 0 ? `(${executeIds.size})` : ''}
                </p>
                <ExecutePersonaPicker selectedIds={executeIds} onToggle={toggleExecuteId} disabled={submitting} />
              </div>
            )}
          </div>

          <div>
            <label className="block typo-caption text-foreground mb-1.5">{s.field_expiry_label}</label>
            <div className="flex gap-1.5">
              {EXPIRY_OPTIONS.map((opt) => {
                const active = expiresInDays === opt.days;
                return (
                  <button
                    key={opt.labelKey}
                    type="button"
                    onClick={() => setExpiresInDays(opt.days)}
                    disabled={submitting}
                    className={`flex-1 px-2 py-1.5 rounded-interactive typo-caption border transition-colors disabled:opacity-50 ${
                      active ? 'border-primary/50 bg-primary/15 text-foreground' : 'border-border/30 bg-secondary/30 text-foreground hover:bg-secondary/50'
                    }`}
                  >
                    {s[opt.labelKey]}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <div className="typo-caption text-red-400 bg-red-400/10 rounded p-2">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/30">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 rounded-interactive typo-caption text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
          >
            {s.cancel}
          </button>
          <AsyncButton
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            isLoading={submitting}
            disabled={!name.trim() || totalScopeCount === 0}
          >
            {s.generate_key}
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}
