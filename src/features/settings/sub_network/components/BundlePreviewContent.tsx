import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { BundleImportPreview, BundleResourcePreview } from '@/api/network/bundle';
import { NetworkAccessScopeBadge } from './NetworkAccessScopeBadge';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Discriminator for which danger warning the user explicitly acknowledged.
 *  - `'tamper'`   → trusted peer with a bad signature (possible tampering)
 *  - `'unknown'`  → unknown signer (cannot verify)
 *  - `null`       → no acknowledgement
 *
 * The two warnings are mutually exclusive at render time, but `signer_trusted`
 * is server-derived and can flip between preview re-fetches. A single shared
 * boolean previously let consent for warning A silently carry over into
 * warning B; tagging by kind closes the carry-over and gives any future
 * audit log a record of which danger was accepted.
 */
export type DangerConfirmKind = 'tamper' | 'unknown' | null;

export function BundlePreviewContent({
  preview,
  skipConflicts,
  setSkipConflicts,
  renamePrefix,
  setRenamePrefix,
  dangerConfirmed,
  setDangerConfirmed,
}: {
  preview: BundleImportPreview;
  skipConflicts: boolean;
  setSkipConflicts: (v: boolean) => void;
  renamePrefix: string;
  setRenamePrefix: (v: string) => void;
  dangerConfirmed: DangerConfirmKind;
  setDangerConfirmed: (v: DangerConfirmKind) => void;
}) {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const hasConflicts = preview.resources.some((r) => r.conflict);

  return (
    <div className="space-y-3">
      {/* Signer info */}
      <div className={`rounded-card border p-3 space-y-2 ${
        !preview.signature_valid
          ? 'border-status-error/30 bg-status-error/5'
          : 'border-border bg-secondary/10'
      }`}>
        <div className="flex items-center gap-2">
          {preview.signature_valid ? (
            <ShieldCheck className="w-4 h-4 text-status-success" />
          ) : (
            <ShieldOff className="w-4 h-4 text-status-error" />
          )}
          <div>
            <div className="typo-body text-foreground">{preview.signer_display_name}</div>
            <div className="typo-caption text-foreground font-mono">
              {preview.signer_peer_id.slice(0, 8)}...{preview.signer_peer_id.slice(-8)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 typo-caption">
          <span className={`px-1.5 py-0.5 rounded-full ${
            preview.signature_valid
              ? 'bg-status-success/10 text-status-success'
              : 'bg-status-error/10 text-status-error'
          }`}>
            {preview.signature_valid
              ? st.signature_verified
              : preview.signer_trusted
                ? st.signature_mismatch
                : st.unverified_signature}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full ${
            preview.signer_trusted
              ? 'bg-status-success/10 text-status-success'
              : 'bg-status-warning/10 text-status-warning'
          }`}>
            {preview.signer_trusted ? st.trusted_peer : st.unknown_peer}
          </span>
        </div>
      </div>

      {/* Network access scope */}
      <NetworkAccessScopeBadge scope={preview.network_scope} />

      {/* Danger: signature mismatch on a trusted peer — possible tampering */}
      {!preview.signature_valid && preview.signer_trusted && (
        <div className="rounded-card border border-status-error/30 bg-status-error/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldOff className="w-4 h-4 text-status-error mt-0.5 flex-shrink-0" />
            <div className="typo-caption text-status-error space-y-1">
              <p className="font-medium">{st.danger_trusted_title}</p>
              <p className="text-status-error/80">
                {st.danger_trusted_body}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 typo-caption text-status-error cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={dangerConfirmed === 'tamper'}
              onChange={(e) => setDangerConfirmed(e.target.checked ? 'tamper' : null)}
              className="rounded-interactive border-status-error/40"
            />
            {st.danger_trusted_confirm}
          </label>
        </div>
      )}

      {/* Warning: unknown signer — signature cannot be verified */}
      {!preview.signature_valid && !preview.signer_trusted && (
        <div className="rounded-card border border-status-error/30 bg-status-error/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldOff className="w-4 h-4 text-status-error mt-0.5 flex-shrink-0" />
            <div className="typo-caption text-status-error space-y-1">
              <p className="font-medium">{st.danger_unknown_title}</p>
              <p className="text-status-error/80">
                {st.danger_unknown_body}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 typo-caption text-status-error cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={dangerConfirmed === 'unknown'}
              onChange={(e) => setDangerConfirmed(e.target.checked ? 'unknown' : null)}
              className="rounded-interactive border-status-error/40"
            />
            {st.danger_unknown_confirm}
          </label>
        </div>
      )}

      {/* Resources list */}
      <div>
        <div className="typo-caption text-foreground mb-1.5">
          {tx(preview.resources.length === 1 ? st.resources_in_bundle_one : st.resources_in_bundle_other, { count: preview.resources.length })}
        </div>
        <div className="max-h-[30vh] overflow-y-auto space-y-1 pr-1">
          {preview.resources.map((resource) => (
            <ResourcePreviewItem key={resource.resource_id} resource={resource} />
          ))}
        </div>
      </div>

      {/* Conflict options */}
      {hasConflicts && (
        <div className="rounded-card border border-status-warning/20 bg-status-warning/5 p-3 space-y-2">
          <div className="typo-caption text-status-warning">{st.naming_conflicts_detected}</div>
          <label className="flex items-center gap-2 typo-caption text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={skipConflicts}
              onChange={(e) => setSkipConflicts(e.target.checked)}
              className="rounded-interactive border-border"
            />
            {st.skip_conflicting}
          </label>
          {!skipConflicts && (
            <div>
              <label className="typo-caption text-foreground mb-1 block">{st.rename_prefix_label}</label>
              <input
                value={renamePrefix}
                onChange={(e) => setRenamePrefix(e.target.value)}
                placeholder={st.rename_prefix_placeholder}
                className="w-full px-2 py-1 typo-caption rounded-card border border-border bg-background focus-ring"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResourcePreviewItem({ resource }: { resource: BundleResourcePreview }) {
  const { t: _t } = useTranslation();
  const st = _t.sharing;
  return (
    <div className={`rounded-card border p-2 flex items-center gap-2 ${
      resource.conflict
        ? 'border-status-warning/20 bg-status-warning/5'
        : 'border-border bg-secondary/10'
    }`}>
      <div className="min-w-0 flex-1">
        <div className="typo-body text-foreground truncate">{resource.display_name}</div>
        <div className="typo-caption text-foreground flex items-center gap-1.5">
          <span>{resource.resource_type}</span>
          <span className="text-foreground">·</span>
          <span>{resource.access_level}</span>
        </div>
      </div>
      {resource.conflict && (
        <span className="typo-caption px-1.5 py-0.5 text-status-warning flex-shrink-0">
          {st.conflict}
        </span>
      )}
    </div>
  );
}
