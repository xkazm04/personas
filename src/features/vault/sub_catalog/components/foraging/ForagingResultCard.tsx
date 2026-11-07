import {
  CheckCircle2,
  Cloud,
  FileKey,
  Globe,
  HardDrive,
  Server,
  Shield,
  Terminal,
} from "lucide-react";
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ForagedCredential, ForageSource } from "@/api/vault/foraging";
import { useTranslation } from "@/i18n/useTranslation";
import type { Translations } from "@/i18n/en";
import { tokenLabel } from "@/i18n/tokenMaps";

type ForagingLabelKey = keyof Translations['vault']['foraging'];

interface ForagingResultCardProps {
  credential: ForagedCredential;
  isSelected: boolean;
  isImporting: boolean;
  isImported: boolean;
  onToggle: () => void;
}

const SOURCE_META: Record<ForageSource, { icon: typeof Cloud; labelKey: ForagingLabelKey; color: string }> = {
  aws_credentials: { icon: Cloud, labelKey: "source_aws_credentials", color: "text-status-warning" },
  aws_config: { icon: Cloud, labelKey: "source_aws_config", color: "text-status-warning" },
  kube_config: { icon: Server, labelKey: "source_kube_config", color: "text-status-info" },
  env_var: { icon: Terminal, labelKey: "source_env_var", color: "text-status-success" },
  dot_env: { icon: FileKey, labelKey: "source_dot_env", color: "text-role-agent" },
  npmrc: { icon: HardDrive, labelKey: "source_npmrc", color: "text-status-error" },
  docker_config: { icon: Server, labelKey: "source_docker_config", color: "text-role-highlight" },
  git_hub_cli: { icon: Globe, labelKey: "source_git_hub_cli", color: "text-role-agent" },
  ssh_key: { icon: Shield, labelKey: "source_ssh_key", color: "text-status-warning" },
  git_config: { icon: Globe, labelKey: "source_git_config", color: "text-role-human" },
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-status-success/15 text-status-success border-status-success/20",
  medium: "bg-status-warning/15 text-status-warning border-status-warning/20",
  low: "bg-zinc-500/15 text-ink-2 border-zinc-500/20",
};

const FALLBACK_SOURCE_META: { icon: typeof Cloud; labelKey: ForagingLabelKey; color: string } = {
  icon: FileKey,
  labelKey: "source_unknown",
  color: "text-foreground",
};

const FALLBACK_CONFIDENCE_STYLE = "bg-zinc-500/15 text-ink-2 border-zinc-500/20";

export function ForagingResultCard({
  credential,
  isSelected,
  isImporting,
  isImported,
  onToggle,
}: ForagingResultCardProps) {
  const { t } = useTranslation();
  const fg = t.vault.foraging;
  const meta = SOURCE_META[credential.source] ?? FALLBACK_SOURCE_META;
  const sourceLabel = fg[meta.labelKey];
  const Icon = meta.icon;
  const disabled = credential.already_imported || isImported || isImporting;

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      aria-pressed={isSelected}
      className={`animate-fade-slide-in w-full text-left rounded-modal border p-3 transition-all ${
        isImported
          ? "border-status-success/30 bg-status-success/5 opacity-70"
          : credential.already_imported
            ? "border-hair bg-surface-1 opacity-50 cursor-default"
            : isSelected
              ? "border-role-agent/40 bg-role-agent/8 ring-1 ring-role-agent/20"
              : "border-hair bg-surface-1 hover:bg-surface-2 hover:border-primary/25"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox area */}
        <div className="mt-0.5 flex-shrink-0">
          {isImporting ? (
            <LoadingSpinner className="text-role-agent" />
          ) : isImported ? (
            <CheckCircle2 className="w-4 h-4 text-status-success" />
          ) : credential.already_imported ? (
            <CheckCircle2 className="w-4 h-4 text-foreground" />
          ) : (
            <div
              className={`w-4 h-4 rounded-interactive border-2 transition-colors ${
                isSelected
                  ? "border-role-agent bg-role-agent/30"
                  : "border-hair bg-transparent"
              }`}
            >
              {isSelected && (
                <svg viewBox="0 0 16 16" className="w-full h-full text-role-agent">
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
            <span className="typo-body text-ink-1 truncate">
              {credential.label}
            </span>
            {credential.already_imported && (
              <span className="typo-body px-1.5 py-0.5 rounded-interactive bg-muted-foreground/10 text-foreground">
                {fg.already_in_vault}
              </span>
            )}
            {isImported && (
              <span className="typo-body text-status-success">
                {fg.imported}
              </span>
            )}
          </div>

          {/* Field preview */}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Object.entries(credential.fields).map(([key, val]) => (
              <span
                key={key}
                className="inline-flex items-center gap-1 typo-code px-1.5 py-0.5 rounded-interactive bg-surface-2 text-foreground"
              >
                <span className="text-foreground">{key}:</span>
                <span className="truncate max-w-[120px]">{val}</span>
              </span>
            ))}
          </div>

          {/* Source + confidence */}
          <div className="mt-1.5 flex items-center gap-2">
            <span className="typo-body text-foreground">{sourceLabel}</span>
            <span
              className={`typo-body px-1.5 py-0.5 rounded-interactive border ${CONFIDENCE_STYLES[credential.confidence] ?? FALLBACK_CONFIDENCE_STYLE}`}
            >
              {tokenLabel(t, 'forage_confidence', credential.confidence)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
