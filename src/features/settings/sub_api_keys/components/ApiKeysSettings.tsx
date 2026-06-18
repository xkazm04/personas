/**
 * Settings → API Keys
 *
 * Manages the keys 3rd-party MCP clients use to authenticate against the
 * production HTTP server (engine/management_api.rs, port 9420). Key
 * primitives — generation, revocation, deletion — are already exposed
 * as Tauri commands (commands/credentials/external_api_keys.rs); this
 * page is the UI for them.
 *
 * Security model:
 *   - Plaintext token leaves the backend exactly ONCE on creation. We
 *     surface it to the user with a copy-to-clipboard affordance and a
 *     "I have stored it" acknowledgment before dismissing.
 *   - Stored as SHA-256; revoke flips a flag (audit trail), delete
 *     removes the row.
 *   - The per-row "system" key is the desktop frontend's own internal
 *     key (created on-demand by management_api). We hide it from the
 *     user-facing list — it isn't theirs to manage.
 */
import { useCallback, useEffect, useState } from 'react';
import { Key, Plus, Check, AlertTriangle, Trash2, ShieldOff, RefreshCw, Clock3 } from 'lucide-react';
import {
  ContentBox,
  ContentHeader,
  ContentBody,
} from '@/features/shared/components/layout/ContentLayout';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import {
  createExternalApiKey,
  listExternalApiKeys,
  revokeExternalApiKey,
  deleteExternalApiKey,
  type ExternalApiKey,
  type CreateApiKeyResponse,
} from '@/api/auth/externalApiKeys';
import { formatRelativeTime, formatTimestamp } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { RecentChangeChip } from '@/features/settings/shared/RecentChangeChip';

// A key is considered "stale" — i.e. probably forgotten — when it's older than
// the grace window AND either never used or unused for the inactivity window.
// Pulled out so the threshold is one obvious knob to tune later.
const STALE_GRACE_DAYS = 7;
const STALE_INACTIVE_DAYS = 30;
const DAY_MS = 86_400_000;

function isStaleKey(key: ExternalApiKey): boolean {
  if (key.revoked_at !== null || !key.enabled) return false;
  const now = Date.now();
  const created = new Date(key.created_at).getTime();
  if (isNaN(created) || now - created < STALE_GRACE_DAYS * DAY_MS) return false;
  if (key.last_used_at === null) return true;
  const lastUsed = new Date(key.last_used_at).getTime();
  if (isNaN(lastUsed)) return false;
  return now - lastUsed >= STALE_INACTIVE_DAYS * DAY_MS;
}
import { McpServerInfoPanel } from './McpServerInfoPanel';
import { CreateApiKeyDialog } from './CreateApiKeyDialog';
import { CreatedKeyDialog } from './CreatedKeyDialog';

const HIDDEN_KEY_NAMES = new Set(['system']);

export default function ApiKeysSettings() {
  const { t } = useTranslation();
  const s = t.settings.api_keys;

  const [keys, setKeys] = useState<ExternalApiKey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listExternalApiKeys();
      setKeys(all.filter((k) => !HIDDEN_KEY_NAMES.has(k.name)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(
    async (name: string, scopes: string[]) => {
      const resp = await createExternalApiKey(name, scopes);
      setCreatedKey(resp);
      setShowCreate(false);
      void load();
    },
    [load],
  );

  const handleRevoke = useCallback(
    async (id: string) => {
      setActioning(id);
      try {
        await revokeExternalApiKey(id);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setActioning(null);
      }
    },
    [load],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setActioning(id);
      try {
        await deleteExternalApiKey(id);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setActioning(null);
      }
    },
    [load],
  );

  const visibleKeys = keys ?? [];
  const activeCount = visibleKeys.filter((k) => k.enabled && !k.revoked_at).length;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Key className="w-5 h-5 text-fuchsia-400" />}
        title={s.title}
        subtitle={loading ? s.loading : `${activeCount} ${s.active_keys}`}
        actions={
          <div className="flex items-center gap-2">
            <RecentChangeChip category="api_keys" />
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary text-primary-foreground typo-caption font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {s.create_key}
            </button>
          </div>
        }
      />
      <ContentBody>
        {error && (
          <div className="flex items-center gap-2 typo-caption text-red-400 bg-red-400/10 rounded p-2 mb-3">
            <AlertTriangle size={14} />
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-auto inline-flex items-center gap-1 hover:text-red-300"
            >
              <RefreshCw size={12} />
              {s.retry}
            </button>
          </div>
        )}

        <p className="typo-body text-foreground leading-relaxed mb-4">{s.description}</p>

        <McpServerInfoPanel />

        <div className="mt-6">
          <SectionCard title={s.your_keys} icon={<Key className="w-4 h-4 text-fuchsia-400" />} titleClassName="text-primary">
            <div className="space-y-2">
              {loading && !keys && (
                <div className="typo-caption text-foreground py-6 text-center">
                  {s.loading_keys}
                </div>
              )}

              {!loading && visibleKeys.length === 0 && (
                <div className="typo-caption text-foreground py-6 text-center bg-secondary/20 rounded">
                  {s.empty}
                </div>
              )}

              {visibleKeys.map((key) => (
                <ApiKeyRow
                  key={key.id}
                  apiKey={key}
                  actioning={actioning === key.id}
                  onRevoke={() => handleRevoke(key.id)}
                  onDelete={() => handleDelete(key.id)}
                />
              ))}
            </div>
          </SectionCard>
        </div>
      </ContentBody>

      {showCreate && (
        <CreateApiKeyDialog
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
      {createdKey && (
        <CreatedKeyDialog
          response={createdKey}
          onClose={() => setCreatedKey(null)}
        />
      )}
    </ContentBox>
  );
}

interface ApiKeyRowProps {
  apiKey: ExternalApiKey;
  actioning: boolean;
  onRevoke: () => void;
  onDelete: () => void;
}

function ApiKeyRow({ apiKey, actioning, onRevoke, onDelete }: ApiKeyRowProps) {
  const { t } = useTranslation();
  const s = t.settings.api_keys;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isRevoked = apiKey.revoked_at !== null || !apiKey.enabled;
  const scopes: string[] = (() => {
    try {
      return JSON.parse(apiKey.scopes) as string[];
    } catch {
      return [];
    }
  })();
  const lastUsedRelative = formatRelativeTime(apiKey.last_used_at, s.never_used, {
    dateFallbackDays: 30,
  });
  const lastUsedAbsolute = apiKey.last_used_at
    ? formatTimestamp(apiKey.last_used_at)
    : null;
  const createdRelative = formatRelativeTime(apiKey.created_at, '', { dateFallbackDays: 60 });
  const createdAbsolute = formatTimestamp(apiKey.created_at);
  const stale = !isRevoked && isStaleKey(apiKey);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-card border ${
        isRevoked
          ? 'border-border/20 bg-secondary/10 opacity-60'
          : stale
          ? 'border-amber-400/30 bg-amber-400/5'
          : 'border-border/30 bg-secondary/20'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="typo-body font-medium text-foreground truncate">{apiKey.name}</span>
          {isRevoked && (
            <span className="typo-caption text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
              {s.revoked}
            </span>
          )}
          {stale && (
            <span
              className="typo-caption text-amber-400 bg-amber-400/10 border border-amber-400/30 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              title={s.stale_tooltip}
            >
              <Clock3 size={10} />
              {s.stale_chip}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <code className="typo-code text-foreground">{apiKey.key_prefix}…</code>
          <span className="typo-caption text-foreground">·</span>
          <span className="typo-caption text-foreground">
            {scopes.length > 0 ? scopes.join(', ') : s.no_scopes}
          </span>
          <span className="typo-caption text-foreground">·</span>
          <span
            className={`typo-caption ${stale ? 'text-amber-400/80' : 'text-foreground'}`}
            title={lastUsedAbsolute ?? undefined}
          >
            {s.last_used}: {lastUsedRelative}
          </span>
          <span className="typo-caption text-foreground">·</span>
          <span className="typo-caption text-foreground" title={createdAbsolute}>
            {s.created_label}: {createdRelative}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!isRevoked && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={actioning}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption text-foreground hover:text-amber-400 hover:bg-amber-400/10 transition-colors disabled:opacity-50"
            title={s.revoke_tooltip}
          >
            <ShieldOff size={12} />
            {s.revoke}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              setTimeout(() => setConfirmDelete(false), 3000);
              return;
            }
            setConfirmDelete(false);
            onDelete();
          }}
          disabled={actioning}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption transition-colors disabled:opacity-50 ${
            confirmDelete
              ? 'text-red-400 bg-red-400/10 hover:bg-red-400/20'
              : 'text-foreground hover:text-red-400 hover:bg-red-400/10'
          }`}
          title={s.delete_tooltip}
        >
          {confirmDelete ? (
            <>
              <Check size={12} />
              {s.confirm_delete}
            </>
          ) : (
            <>
              <Trash2 size={12} />
              {s.delete}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
