import { Brain, Cpu, Layers, Hash, Calendar } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { KnowledgeBase } from '@/api/vault/database/vectorKb';

interface SettingsTabProps {
  kb: KnowledgeBase;
}

export function SettingsTab({ kb }: SettingsTabProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Info card */}
      <div className="rounded-modal border border-primary/10 bg-secondary/20 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-400" />
          {sh.kb_info}
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <InfoRow icon={Hash} label={sh.label_id} value={kb.id} mono />
          <InfoRow icon={Layers} label={sh.label_status} value={kb.status} />
          <InfoRow icon={Cpu} label={sh.label_embedding_model} value={kb.embeddingModel} mono />
          <InfoRow icon={Hash} label={sh.label_dimensions} value={String(kb.embeddingDims)} />
          <InfoRow icon={Layers} label={sh.label_chunk_size} value={`${kb.chunkSize} chars`} />
          <InfoRow icon={Layers} label={sh.label_chunk_overlap} value={`${kb.chunkOverlap} chars`} />
          <InfoRow icon={Calendar} label={sh.label_created} value={formatDate(kb.createdAt)} />
          <InfoRow icon={Calendar} label={sh.label_updated} value={formatDate(kb.updatedAt)} />
        </div>
      </div>

      {/* Stats */}
      <div className="rounded-modal border border-primary/10 bg-secondary/20 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground/90">{sh.statistics}</h3>
        <div className="grid grid-cols-2 gap-4">
          <StatCard label={sh.label_documents} value={kb.documentCount} />
          <StatCard label={sh.label_chunks} value={kb.chunkCount} />
        </div>
      </div>

      {/* Model info */}
      <div className="rounded-modal border border-violet-500/10 bg-violet-500/5 p-5 space-y-2">
        <h3 className="text-sm font-semibold text-violet-300/90 flex items-center gap-2">
          <Cpu className="w-4 h-4" />
          {sh.local_embedding}
        </h3>
        <p className="text-xs text-foreground leading-relaxed">
          Embeddings are generated locally using {kb.embeddingModel} ({kb.embeddingDims}-dim).
          No data leaves your machine. The model (~23MB) is downloaded on first use and cached locally.
        </p>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, mono }: { icon: typeof Brain; label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-foreground flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </p>
      <p className={`text-sm text-foreground truncate ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card bg-secondary/30 border border-primary/10 p-3 text-center">
      <p className="text-2xl font-semibold text-foreground/90">{value.toLocaleString()}</p>
      <p className="text-xs text-foreground mt-1">{label}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
