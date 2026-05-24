import { GitFork } from 'lucide-react';
import type { ResourceProvenance } from '@/api/network/exposure';

interface ProvenanceBadgeProps {
  provenance: ResourceProvenance | null;
}

export function ProvenanceBadge({ provenance }: ProvenanceBadgeProps) {
  if (!provenance) return null;

  const bundleInfo = provenance.bundle_hash
    ? `\nBundle: ${provenance.bundle_hash.slice(0, 12)}...`
    : '';

  return (
    <div
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-cyan-500/10 text-cyan-400 cursor-default"
      title={`Imported from ${provenance.source_display_name} (${provenance.source_peer_id})${bundleInfo}\nVerified: ${provenance.signature_verified ? 'Yes' : 'No'}`}
    >
      <GitFork className="w-3 h-3" />
      <span className="truncate max-w-[100px]">{provenance.source_display_name}</span>
    </div>
  );
}
