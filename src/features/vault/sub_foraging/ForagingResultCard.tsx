import { motion } from "framer-motion";
import {
  CheckCircle2,
  Cloud,
  FileKey,
  Globe,
  HardDrive,
  Loader2,
  Server,
  Shield,
  Terminal,
} from "lucide-react";
import type { ForagedCredential, ForageSource } from "@/api/foraging";

interface ForagingResultCardProps {
  credential: ForagedCredential;
  isSelected: boolean;
  isImporting: boolean;
  isImported: boolean;
  onToggle: () => void;
}

const SOURCE_META: Record<ForageSource, { icon: typeof Cloud; label: string; color: string }> = {
  aws_credentials: { icon: Cloud, label: "AWS Credentials", color: "text-amber-400" },
  aws_config: { icon: Cloud, label: "AWS Config", color: "text-amber-400" },
  kube_config: { icon: Server, label: "Kubernetes", color: "text-blue-400" },
  env_var: { icon: Terminal, label: "Env Variable", color: "text-emerald-400" },
  dot_env: { icon: FileKey, label: ".env File", color: "text-violet-400" },
  npmrc: { icon: HardDrive, label: "npmrc", color: "text-red-400" },
  docker_config: { icon: Server, label: "Docker", color: "text-cyan-400" },
  git_hub_cli: { icon: Globe, label: "GitHub CLI", color: "text-purple-400" },
  ssh_key: { icon: Shield, label: "SSH Key", color: "text-orange-400" },
  git_config: { icon: Globe, label: "Git Config", color: "text-pink-400" },
};

const CONFIDENCE_STYLES = {
  high: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  low: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
};

export function ForagingResultCard({
  credential,
  isSelected,
  isImporting,
  isImported,
  onToggle,
}: ForagingResultCardProps) {
  const meta = SOURCE_META[credential.source] ?? SOURCE_META.env_var;
  const Icon = meta.icon;
  const disabled = credential.already_imported || isImported || isImporting;

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      className={`w-full text-left rounded-xl border p-3 transition-all ${
        isImported
          ? "border-emerald-500/30 bg-emerald-500/5 opacity-70"
          : credential.already_imported
            ? "border-primary/10 bg-secondary/20 opacity-50 cursor-default"
            : isSelected
              ? "border-violet-500/40 bg-violet-500/8 ring-1 ring-violet-500/20"
              : "border-primary/15 bg-secondary/25 hover:bg-secondary/40 hover:border-primary/25"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox area */}
        <div className="mt-0.5 flex-shrink-0">
          {isImporting ? (
            <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
          ) : isImported ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : credential.already_imported ? (
            <CheckCircle2 className="w-4 h-4 text-muted-foreground/40" />
          ) : (
            <div
              className={`w-4 h-4 rounded border-2 transition-colors ${
                isSelected
                  ? "border-violet-400 bg-violet-500/30"
                  : "border-primary/20 bg-transparent"
              }`}
            >
              {isSelected && (
                <svg viewBox="0 0 16 16" className="w-full h-full text-violet-300">
                  <path d="M4 8l3 3 5-5" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Icon className={`w-3.5 h-3.5 ${meta.color} flex-shrink-0`} />
            <span className="text-sm font-medium text-foreground/90 truncate">
              {credential.label}
            </span>
            {credential.already_imported && (
              <span className="text-sm px-1.5 py-0.5 rounded bg-muted-foreground/10 text-muted-foreground/50 font-medium">
                Already in vault
              </span>
            )}
            {isImported && (
              <span className="text-sm px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
                Imported
              </span>
            )}
          </div>

          {/* Field preview */}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Object.entries(credential.fields).map(([key, val]) => (
              <span
                key={key}
                className="inline-flex items-center gap-1 text-sm px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground/70 font-mono"
              >
                <span className="text-foreground/50">{key}:</span>
                <span className="truncate max-w-[120px]">{val}</span>
              </span>
            ))}
          </div>

          {/* Source + confidence */}
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-sm text-muted-foreground/50">{meta.label}</span>
            <span
              className={`text-sm px-1.5 py-0.5 rounded border font-medium ${CONFIDENCE_STYLES[credential.confidence]}`}
            >
              {credential.confidence}
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}
