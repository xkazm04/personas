import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { LangfuseStackInfo } from "@/lib/bindings/LangfuseStackInfo";
import type { LangfuseStackState } from "@/lib/bindings/LangfuseStackState";
import { StackProgress } from "./StackProgress";
import type { UseLangfuseStack } from "./hooks/useLangfuseStack";
import { silentCatch } from '@/lib/silentCatch';
import { DebtText } from '@/i18n/DebtText';



interface ManagedStackPanelProps {
  stack: UseLangfuseStack;
  preferredPort: number;
}

export function ManagedStackPanel({ stack, preferredPort }: ManagedStackPanelProps) {
  const { t, tx } = useTranslation();
  const info = stack.info;

  const [showConfig, setShowConfig] = useState(false);
  const [revealPassword, setRevealPassword] = useState(false);
  const [copied, setCopied] = useState<"email" | "password" | null>(null);
  const [portInput, setPortInput] = useState<number>(preferredPort);
  const [refreshing, setRefreshing] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetTyped, setResetTyped] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setPortInput(preferredPort);
  }, [preferredPort]);

  // Auto-load admin credentials once the stack reports Running.
  useEffect(() => {
    if (info?.state === "running" && !stack.adminCredentials) {
      void stack.loadAdminCredentials();
    }
  }, [info?.state, stack]);

  if (!info) return null;

  const transitioning = stack.jobInFlight;
  const canStart =
    !transitioning &&
    info.dockerInstalled &&
    info.dockerRunning &&
    info.composeAvailable &&
    info.state !== "running";
  const canStop = !transitioning && info.state !== "stopped" && info.state !== "notInstalled";
  // Only reveal the credentials + Open UI button when the stack is *truly*
  // running (containers up + health endpoint reachable) and no lifecycle
  // job is in flight. "Unhealthy" used to enable both, but it gave the
  // user a button that loaded a 500 page.
  const showAdminReveal = info.state === "running" && !transitioning;
  const showOpenUi = info.state === "running" && !transitioning;
  const dockerOk = info.dockerInstalled && info.dockerRunning && info.composeAvailable;
  const portMismatch =
    info.stackInitialized && info.port !== preferredPort && info.state === "running";

  const copy = async (kind: "email" | "password", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch (err) { silentCatch("features/plugins/langfuse/ManagedStackPanel:catch1")(err); }
  };

  return (
    <div className="space-y-5">
      <StatusRow info={info} starting={stack.starting} stopping={stack.stopping} />
      <DockerPreflight info={info} stack={stack} />

      {/* In-flight progress — always shown when a job is running */}
      {stack.jobInFlight && stack.jobKind && (
        <StackProgress
          jobKind={stack.jobKind}
          fraction={stack.fraction}
          etaSeconds={stack.etaSeconds}
          message={stack.message}
        />
      )}

      {/* Outcome banner — shown until dismissed */}
      {!stack.jobInFlight && stack.lastOutcome && (
        <OutcomeBanner stack={stack} t={t} tx={tx} />
      )}

      {/* Resource warning before first start */}
      {info.state === "notInstalled" && dockerOk && !stack.jobInFlight && (
        <div className="flex items-start gap-2 p-3 rounded-card border border-amber-500/20 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 flex-shrink-0" />
          <div className="space-y-1">
            <div className="typo-body font-medium text-foreground">
              {t.plugins.langfuse.resource_warning_title}
            </div>
            <div className="typo-caption text-foreground">
              {t.plugins.langfuse.resource_warning_body}
            </div>
            <div className="typo-caption text-foreground italic">
              {t.plugins.langfuse.first_start_note}
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void stack.start()}
          disabled={!canStart}
          className="inline-flex items-center gap-2 px-4 py-2 typo-body rounded-modal border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {stack.starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {stack.starting ? t.plugins.langfuse.starting_label : t.plugins.langfuse.start_button}
        </button>
        <button
          type="button"
          onClick={() => void stack.stop()}
          disabled={!canStop}
          className="inline-flex items-center gap-2 px-4 py-2 typo-body rounded-modal border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {stack.stopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
          {stack.stopping ? t.plugins.langfuse.stopping_label : t.plugins.langfuse.stop_button}
        </button>
        {showOpenUi && (
          <button
            type="button"
            onClick={() => void stack.openUi()}
            className="inline-flex items-center gap-2 px-4 py-2 typo-body rounded-modal border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {t.plugins.langfuse.open_ui_button}
          </button>
        )}
      </div>

      {/* Admin credentials */}
      {showAdminReveal && stack.adminCredentials && (
        <div className="rounded-card border border-primary/10 bg-secondary/10 p-4 space-y-3">
          <div>
            <div className="typo-caption uppercase tracking-widest text-foreground">
              {t.plugins.langfuse.credentials_section}
            </div>
            <div className="typo-caption text-foreground mt-1">
              {t.plugins.langfuse.credentials_intro}
            </div>
          </div>
          <CredentialRow
            label={t.plugins.langfuse.admin_email_label}
            value={stack.adminCredentials.email}
            visible
            copied={copied === "email"}
            onCopy={() => void copy("email", stack.adminCredentials!.email)}
            copyLabel={t.plugins.langfuse.admin_password_copy}
            copiedLabel={t.plugins.langfuse.admin_password_copied}
          />
          <CredentialRow
            label={t.plugins.langfuse.admin_password_label}
            value={stack.adminCredentials.password}
            visible={revealPassword}
            copied={copied === "password"}
            onCopy={() => void copy("password", stack.adminCredentials!.password)}
            onToggleVisibility={() => setRevealPassword((v) => !v)}
            revealLabel={t.plugins.langfuse.admin_password_reveal}
            hideLabel={t.plugins.langfuse.admin_password_hide}
            copyLabel={t.plugins.langfuse.admin_password_copy}
            copiedLabel={t.plugins.langfuse.admin_password_copied}
          />
        </div>
      )}

      {/* Port preference */}
      <div className="rounded-card border border-primary/10 bg-secondary/5 p-4 space-y-3">
        <div>
          <div className="typo-caption uppercase tracking-widest text-foreground">
            {t.plugins.langfuse.port_section}
          </div>
          <div className="typo-caption text-foreground mt-1">
            {t.plugins.langfuse.port_desc}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2">
            <span className="typo-body text-foreground">{t.plugins.langfuse.port_label}</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={portInput}
              onChange={(e) => setPortInput(Math.max(1, Math.min(65535, Number(e.target.value) || 0)))}
              className="w-24 px-3 py-1.5 typo-body rounded-input bg-secondary/30 border border-primary/10 focus:border-indigo-400/40 focus-ring"
            />
          </label>
          <button
            type="button"
            onClick={() => void stack.savePreferredPort(portInput)}
            disabled={portInput === preferredPort || stack.jobInFlight}
            className="inline-flex items-center gap-1 px-3 py-1.5 typo-caption rounded-modal border border-primary/15 bg-secondary/40 text-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors"
          >
            {t.plugins.langfuse.port_save}
          </button>
          {info.stackInitialized && (
            <span className="typo-caption text-foreground">
              {tx(t.plugins.langfuse.port_actual, { port: info.port })}
            </span>
          )}
        </div>
        {portMismatch && (
          <div className="flex items-start gap-2 typo-caption text-amber-200/90">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{t.plugins.langfuse.port_restart_hint}</span>
          </div>
        )}
      </div>

      {/* Config files reveal */}
      {info.stackInitialized && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            className="inline-flex items-center gap-2 typo-caption text-foreground hover:text-foreground transition-colors"
          >
            <Folder className="w-3.5 h-3.5" />
            {showConfig ? t.plugins.langfuse.hide_config : t.plugins.langfuse.show_config}
          </button>
          {showConfig && (
            <div className="rounded-card border border-primary/10 bg-secondary/10 p-3 space-y-1">
              <div className="typo-caption text-foreground">
                {t.plugins.langfuse.config_files_intro}
              </div>
              <div className="typo-code text-foreground select-all break-all">{info.stackDir}</div>
            </div>
          )}
        </div>
      )}

      {/* Maintenance — destructive ops behind explicit confirmation */}
      {info.stackInitialized && (
        <div className="rounded-card border border-primary/10 bg-secondary/5 p-4 space-y-3">
          <div className="typo-caption uppercase tracking-widest text-foreground">
            {t.plugins.langfuse.maintenance_section}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                setRefreshing(true);
                try {
                  await stack.refreshImages();
                } finally {
                  setRefreshing(false);
                }
              }}
              disabled={refreshing || stack.jobInFlight || !info.dockerRunning}
              className="inline-flex items-center gap-2 px-3 py-1.5 typo-caption rounded-modal border border-primary/15 bg-secondary/40 text-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors"
            >
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {refreshing ? t.plugins.langfuse.refreshing_images : t.plugins.langfuse.refresh_images_button}
            </button>
            <span className="typo-caption text-foreground">
              {t.plugins.langfuse.refresh_images_hint}
            </span>
          </div>

          {!resetConfirmOpen ? (
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              disabled={stack.jobInFlight || resetting}
              className="inline-flex items-center gap-2 px-3 py-1.5 typo-caption rounded-modal border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.plugins.langfuse.reset_button}
            </button>
          ) : (
            <div className="rounded-card border border-red-500/30 bg-red-500/5 p-3 space-y-2">
              <div className="typo-caption text-red-200/90">
                {t.plugins.langfuse.reset_intro}
              </div>
              <div className="typo-caption text-red-200/90">
                {t.plugins.langfuse.reset_confirm}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={resetTyped}
                  onChange={(e) => setResetTyped(e.target.value)}
                  placeholder={t.plugins.langfuse.reset_typed_label}
                  className="flex-1 min-w-[120px] px-3 py-1.5 typo-body rounded-input bg-secondary/30 border border-primary/10 focus:border-red-400/40 focus-ring"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={async () => {
                    setResetting(true);
                    try {
                      await stack.resetVolumes();
                      setResetConfirmOpen(false);
                      setResetTyped("");
                    } finally {
                      setResetting(false);
                    }
                  }}
                  disabled={resetTyped !== "RESET" || resetting}
                  className="inline-flex items-center gap-2 px-3 py-1.5 typo-caption rounded-modal border border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                >
                  {resetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {resetting ? t.plugins.langfuse.resetting : t.plugins.langfuse.reset_apply}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetConfirmOpen(false);
                    setResetTyped("");
                  }}
                  disabled={resetting}
                  className="inline-flex items-center gap-2 px-3 py-1.5 typo-caption rounded-modal border border-primary/15 bg-secondary/40 text-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors"
                >
                  {t.plugins.langfuse.reset_cancel}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {info.error && (
        <div className="flex items-start gap-2 p-3 typo-caption rounded-card border border-red-500/20 bg-red-500/5 text-red-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{info.error}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function StatusRow({
  info,
  starting,
  stopping,
}: {
  info: LangfuseStackInfo;
  starting: boolean;
  stopping: boolean;
}) {
  const { t } = useTranslation();

  let label: string;
  let tone: string;
  let Icon: typeof Circle;
  if (starting) {
    label = t.plugins.langfuse.status_starting;
    tone = "text-amber-300";
    Icon = Loader2;
  } else if (stopping) {
    label = t.plugins.langfuse.stopping_label;
    tone = "text-amber-300";
    Icon = Loader2;
  } else {
    const map = renderState(info.state, t);
    label = map.label;
    tone = map.tone;
    Icon = map.Icon;
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-card border border-primary/10 bg-secondary/10">
      <Icon className={`w-4 h-4 ${tone} ${starting || stopping ? "animate-spin" : ""}`} />
      <div className="flex-1 min-w-0">
        <div className="typo-body font-medium text-foreground">{label}</div>
        <div className="typo-caption text-foreground">
          {info.hostUrl.replace(/^https?:\/\//, "")}
        </div>
      </div>
    </div>
  );
}

function renderState(
  state: LangfuseStackState,
  t: ReturnType<typeof useTranslation>["t"],
): { label: string; tone: string; Icon: typeof Circle } {
  switch (state) {
    case "dockerMissing":
    case "dockerNotRunning":
    case "composeMissing":
      return { label: t.plugins.langfuse.docker_section, tone: "text-amber-300", Icon: AlertTriangle };
    case "notInstalled":
      return { label: t.plugins.langfuse.status_not_installed, tone: "text-foreground", Icon: Circle };
    case "stopped":
    case "partial":
      return { label: t.plugins.langfuse.status_stopped, tone: "text-foreground", Icon: Circle };
    case "running":
      return { label: t.plugins.langfuse.status_running, tone: "text-emerald-400", Icon: CheckCircle2 };
    case "unhealthy":
      return { label: t.plugins.langfuse.status_unhealthy, tone: "text-amber-300", Icon: AlertTriangle };
    default:
      return { label: t.plugins.langfuse.status_unknown, tone: "text-foreground", Icon: Circle };
  }
}

function DockerPreflight({
  info,
  stack,
}: {
  info: LangfuseStackInfo;
  stack: UseLangfuseStack;
}) {
  const { t, tx } = useTranslation();

  if (!info.dockerInstalled) {
    return (
      <div className="flex items-start gap-3 p-3 rounded-card border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="typo-body text-foreground">
            {t.plugins.langfuse.docker_not_installed}
          </div>
          <div className="typo-caption text-foreground">
            {t.plugins.langfuse.install_intro}
          </div>
          <DockerInstallActions stack={stack} />
        </div>
      </div>
    );
  }
  if (!info.dockerRunning) {
    return (
      <div className="flex items-start gap-2 p-3 typo-caption rounded-card border border-amber-500/20 bg-amber-500/5 text-amber-200/90">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <div>{t.plugins.langfuse.docker_not_running}</div>
          <div className="text-foreground">{t.plugins.langfuse.docker_start_hint}</div>
        </div>
      </div>
    );
  }
  if (!info.composeAvailable) {
    return (
      <div className="flex items-start gap-2 p-3 typo-caption rounded-card border border-red-500/20 bg-red-500/5 text-red-300">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span><DebtText k="auto_docker_compose_isn_t_available_please_upda_b5d10f6a" /></span>
      </div>
    );
  }

  return (
    <div className="typo-caption text-foreground">
      {info.dockerVersion
        ? tx(t.plugins.langfuse.docker_detected, { version: info.dockerVersion })
        : t.plugins.langfuse.docker_detected.replace("({version})", "").trim()}
    </div>
  );
}

function DockerInstallActions({ stack }: { stack: UseLangfuseStack }) {
  const { t } = useTranslation();

  // After a successful installer download, the lastOutcome carries the path.
  const downloadedPath =
    stack.lastOutcome?.kind === "installerDownload" && stack.lastOutcome.success
      ? stack.lastOutcome.installerPath
      : null;

  const downloading =
    stack.jobInFlight && stack.jobKind === "installerDownload";

  // On Linux, Docker has no single installer — point users at the docs.
  const supportsAutoDownload =
    typeof navigator !== "undefined" &&
    /Win|Mac/i.test(navigator.platform || "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href="https://www.docker.com/products/docker-desktop/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-3 py-1.5 typo-caption rounded-modal border border-primary/15 bg-secondary/40 text-foreground hover:bg-secondary/60 transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        {t.plugins.langfuse.docker_install_link}
      </a>
      {supportsAutoDownload && !downloadedPath && (
        <button
          type="button"
          onClick={() => void stack.downloadDockerInstaller()}
          disabled={downloading}
          className="inline-flex items-center gap-1 px-3 py-1.5 typo-caption rounded-modal border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-40 transition-colors"
        >
          {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {t.plugins.langfuse.install_download_button}
        </button>
      )}
      {downloadedPath && (
        <button
          type="button"
          onClick={() => void stack.runDockerInstaller(downloadedPath)}
          className="inline-flex items-center gap-1 px-3 py-1.5 typo-caption rounded-modal border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          {t.plugins.langfuse.install_run_button}
        </button>
      )}
    </div>
  );
}

function OutcomeBanner({
  stack,
  t,
  tx,
}: {
  stack: UseLangfuseStack;
  t: ReturnType<typeof useTranslation>["t"];
  tx: ReturnType<typeof useTranslation>["tx"];
}) {
  const o = stack.lastOutcome!;
  const successTone = "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  const errorTone = "border-red-500/30 bg-red-500/10 text-red-300";
  const Icon = o.success ? CheckCircle2 : AlertTriangle;

  let body: string;
  switch (o.kind) {
    case "start":
      body = o.success
        ? t.plugins.langfuse.outcome_started_success
        : tx(t.plugins.langfuse.outcome_started_failure, { error: o.error ?? "" });
      break;
    case "installerDownload":
      body = o.success
        ? t.plugins.langfuse.outcome_installer_success
        : tx(t.plugins.langfuse.outcome_installer_failure, { error: o.error ?? "" });
      break;
    default:
      // Stop succeeded — quiet, no banner needed.
      if (o.success) return null;
      body = o.error ?? "Failed.";
  }

  return (
    <div
      className={`flex items-start gap-2 p-3 typo-body rounded-card border ${o.success ? successTone : errorTone}`}
    >
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span className="flex-1">{body}</span>
      <button
        type="button"
        onClick={() => stack.clearOutcome()}
        className="text-foreground hover:text-foreground"
        aria-label={t.plugins.langfuse.outcome_dismiss}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

interface CredentialRowProps {
  label: string;
  value: string;
  visible: boolean;
  copied: boolean;
  onCopy: () => void;
  onToggleVisibility?: () => void;
  revealLabel?: string;
  hideLabel?: string;
  copyLabel: string;
  copiedLabel: string;
}

function CredentialRow({
  label,
  value,
  visible,
  copied,
  onCopy,
  onToggleVisibility,
  revealLabel,
  hideLabel,
  copyLabel,
  copiedLabel,
}: CredentialRowProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 typo-caption text-foreground flex-shrink-0">{label}</div>
      <div className="flex-1 min-w-0 typo-code text-foreground select-all truncate">
        {visible ? value : "•".repeat(Math.min(value.length, 16))}
      </div>
      {onToggleVisibility && (
        <button
          type="button"
          onClick={onToggleVisibility}
          className="inline-flex items-center gap-1 px-2 py-1 typo-caption rounded border border-primary/10 hover:bg-secondary/40 text-foreground"
        >
          {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {visible ? hideLabel : revealLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 px-2 py-1 typo-caption rounded border border-primary/10 hover:bg-secondary/40 text-foreground"
      >
        <Copy className="w-3 h-3" />
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}
