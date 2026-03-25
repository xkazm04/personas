import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { BundleImportPreview, BundleResourcePreview } from '@/api/network/bundle';
import { NetworkAccessScopeBadge } from './NetworkAccessScopeBadge';

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
  const hasConflicts = preview.resources.some((r) => r.conflict);

  return (
    <div className="space-y-3">
      {/* Signer info */}
      <div className={`rounded-lg border p-3 space-y-2 ${
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
            <div className="text-sm font-medium text-foreground">{preview.signer_display_name}</div>
            <div className="text-[10px] text-muted-foreground font-mono">
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
              ? 'Signature verified'
              : preview.signer_trusted
                ? 'Signature mismatch'
                : 'Unverified signature'}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full ${
            preview.signer_trusted
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-amber-500/10 text-amber-400'
          }`}>
            {preview.signer_trusted ? 'Trusted peer' : 'Unknown peer'}
          </span>
        </div>
      </div>

      {/* Network access scope */}
      <NetworkAccessScopeBadge scope={preview.network_scope} />

      {/* Danger: signature mismatch on a trusted peer — possible tampering */}
      {!preview.signature_valid && preview.signer_trusted && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldOff className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-red-400 space-y-1">
              <p className="font-medium">Signature does not match the trusted key for this peer.</p>
              <p className="text-red-400/80">
                The bundle claims to be from a known peer but the signature verification failed.
                This could indicate tampering. Only proceed if you are certain the source is safe.
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-red-400 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={dangerConfirmed}
              onChange={(e) => setDangerConfirmed(e.target.checked)}
              className="rounded border-red-500/40"
            />
            I understand the risks and want to import this bundle
          </label>
        </div>
      )}

      {/* Warning: unknown signer — signature cannot be verified */}
      {!preview.signature_valid && !preview.signer_trusted && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldOff className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-red-400 space-y-1">
              <p className="font-medium">This bundle is from an unknown signer and cannot be verified.</p>
              <p className="text-red-400/80">
                The signer is not in your trusted peers list, so the signature cannot be checked
                against a known key. Add the sender as a trusted peer first, or proceed only if you
                fully trust the source.
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-red-400 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={dangerConfirmed}
              onChange={(e) => setDangerConfirmed(e.target.checked)}
              className="rounded border-red-500/40"
            />
            I understand the risks and want to import this unverified bundle
          </label>
        </div>
      )}

      {/* Resources list */}
      <div>
        <div className="text-xs text-muted-foreground mb-1.5">
          {preview.resources.length} resource{preview.resources.length !== 1 ? 's' : ''} in bundle
        </div>
        <div className="max-h-[30vh] overflow-y-auto space-y-1 pr-1">
          {preview.resources.map((resource) => (
            <ResourcePreviewItem key={resource.resource_id} resource={resource} />
          ))}
        </div>
      </div>

      {/* Conflict options */}
      {hasConflicts && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
          <div className="text-xs text-amber-400 font-medium">Naming conflicts detected</div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={skipConflicts}
              onChange={(e) => setSkipConflicts(e.target.checked)}
              className="rounded border-border"
            />
            Skip conflicting resources
          </label>
          {!skipConflicts && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Rename prefix</label>
              <input
                value={renamePrefix}
                onChange={(e) => setRenamePrefix(e.target.value)}
                placeholder="e.g. imported-"
                className="w-full px-2 py-1 text-xs rounded-lg border border-border bg-background focus-ring"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResourcePreviewItem({ resource }: { resource: BundleResourcePreview }) {
  return (
    <div className={`rounded-lg border p-2 flex items-center gap-2 ${
      resource.conflict
        ? 'border-amber-500/20 bg-amber-500/5'
        : 'border-border bg-secondary/10'
    }`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground truncate">{resource.display_name}</div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          <span>{resource.resource_type}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{resource.access_level}</span>
        </div>
      </div>
      {resource.conflict && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 flex-shrink-0">
          conflict
        </span>
      )}
    </div>
  );
}
