import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { BundleImportPreview, BundleResourcePreview } from '@/api/network/bundle';
import { NetworkAccessScopeBadge } from './NetworkAccessScopeBadge';
import { useTranslation } from '@/i18n/useTranslation';

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
  dangerConfirmed: boolean;
  setDangerConfirmed: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const st = t.sharing;
  const hasConflicts = preview.resources.some((r) => r.conflict);

  return (
    <div className="space-y-3">
      {/* Signer info */}
      <div className={`rounded-card border p-3 space-y-2 ${
        !preview.signature_valid
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-border bg-secondary/10'
      }`}>
        <div className="flex items-center gap-2">
          {preview.signature_valid ? (
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          ) : (
            <ShieldOff className="w-4 h-4 text-red-400" />
          )}
          <div>
            <div className="typo-body font-medium text-foreground">{preview.signer_display_name}</div>
            <div className="text-[10px] text-foreground font-mono">
              {preview.signer_peer_id.slice(0, 8)}...{preview.signer_peer_id.slice(-8)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className={`px-1.5 py-0.5 rounded-full ${
            preview.signature_valid
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}>
            {preview.signature_valid
              ? st.signature_verified
              : preview.signer_trusted
                ? st.signature_mismatch
                : st.unverified_signature}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full ${
            preview.signer_trusted
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-amber-500/10 text-amber-400'
          }`}>
            {preview.signer_trusted ? st.trusted_peer : st.unknown_peer}
          </span>
        </div>
      </div>

      {/* Network access scope */}
      <NetworkAccessScopeBadge scope={preview.network_scope} />

      {/* Danger: signature mismatch on a trusted peer — possible tampering */}
      {!preview.signature_valid && preview.signer_trusted && (
        <div className="rounded-card border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldOff className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="typo-caption text-red-400 space-y-1">
              <p className="font-medium">{st.danger_trusted_title}</p>
              <p className="text-red-400/80">
                {st.danger_trusted_body}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 typo-caption text-red-400 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={dangerConfirmed}
              onChange={(e) => setDangerConfirmed(e.target.checked)}
              className="rounded border-red-500/40"
            />
            {st.danger_trusted_confirm}
          </label>
        </div>
      )}

      {/* Warning: unknown signer — signature cannot be verified */}
      {!preview.signature_valid && !preview.signer_trusted && (
        <div className="rounded-card border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldOff className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="typo-caption text-red-400 space-y-1">
              <p className="font-medium">{st.danger_unknown_title}</p>
              <p className="text-red-400/80">
                {st.danger_unknown_body}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 typo-caption text-red-400 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={dangerConfirmed}
              onChange={(e) => setDangerConfirmed(e.target.checked)}
              className="rounded border-red-500/40"
            />
            {st.danger_unknown_confirm}
          </label>
        </div>
      )}

      {/* Resources list */}
      <div>
        <div className="typo-caption text-foreground mb-1.5">
          {preview.resources.length} {preview.resources.length !== 1 ? 'resources' : 'resource'} in bundle
        </div>
        <div className="max-h-[30vh] overflow-y-auto space-y-1 pr-1">
          {preview.resources.map((resource) => (
            <ResourcePreviewItem key={resource.resource_id} resource={resource} />
          ))}
        </div>
      </div>

      {/* Conflict options */}
      {hasConflicts && (
        <div className="rounded-card border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
          <div className="typo-caption text-amber-400 font-medium">{st.naming_conflicts_detected}</div>
          <label className="flex items-center gap-2 typo-caption text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={skipConflicts}
              onChange={(e) => setSkipConflicts(e.target.checked)}
              className="rounded border-border"
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
        ? 'border-amber-500/20 bg-amber-500/5'
        : 'border-border bg-secondary/10'
    }`}>
      <div className="min-w-0 flex-1">
        <div className="typo-body text-foreground truncate">{resource.display_name}</div>
        <div className="text-[10px] text-foreground flex items-center gap-1.5">
          <span>{resource.resource_type}</span>
          <span className="text-foreground">·</span>
          <span>{resource.access_level}</span>
        </div>
      </div>
      {resource.conflict && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 flex-shrink-0">
          {st.conflict}
        </span>
      )}
    </div>
  );
}
