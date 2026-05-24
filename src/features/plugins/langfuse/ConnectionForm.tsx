import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, KeyRound, Globe, Loader2, Save, TestTube2 } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { PasswordToggleField } from '@/features/shared/components/forms/PasswordToggleField';
import type { LangfuseConfig } from "@/lib/bindings/LangfuseConfig";
import type { LangfuseTestResult } from "@/lib/bindings/LangfuseTestResult";
import type { UseLangfuseSettings } from "./hooks/useLangfuseSettings";

interface ConnectionFormProps {
  settings: UseLangfuseSettings;
  initial?: LangfuseConfig | null;
}

export function ConnectionForm({ settings, initial }: ConnectionFormProps) {
  const { t, tx } = useTranslation();

  const [host, setHost] = useState(() => initial?.host ?? "");
  const [publicKey, setPublicKey] = useState(() => initial?.publicKey ?? "");
  const [secretKey, setSecretKey] = useState("");
  const [redactContent, setRedactContent] = useState(() => initial?.redactContent ?? false);
  const [enabled, setEnabled] = useState(() => initial?.enabled ?? true);
  const [projectId, setProjectId] = useState(() => initial?.projectId ?? "");
  const [pushLabScores, setPushLabScores] = useState(() => initial?.pushLabScores ?? false);

  // Saving requires a fresh successful test against the current values, so the
  // on-disk state never reflects untested keys.
  const [verifiedFingerprint, setVerifiedFingerprint] = useState<string | null>(null);
  const currentFingerprint = `${host.trim()}|${publicKey.trim()}|${secretKey.trim()}`;
  const verified = verifiedFingerprint !== null && verifiedFingerprint === currentFingerprint;

  // Reset form when the underlying config changes (e.g. after a save).
  useEffect(() => {
    if (initial) {
      setHost(initial.host);
      setPublicKey(initial.publicKey);
      setRedactContent(initial.redactContent);
      setEnabled(initial.enabled);
      setProjectId(initial.projectId ?? "");
      setPushLabScores(initial.pushLabScores);
    }
  }, [initial]);

  const onTest = async () => {
    const result = await settings.test(host, publicKey, secretKey);
    setVerifiedFingerprint(result.ok ? currentFingerprint : null);
  };

  const onSave = async () => {
    await settings.save({
      host,
      publicKey,
      secretKey,
      redactContent,
      enabled,
      projectId: projectId.trim() ? projectId.trim() : null,
      pushLabScores,
    });
  };

  const lastTest = settings.lastTest;
  const canTest =
    host.trim().length > 0 && publicKey.trim().length > 0 && secretKey.trim().length > 0;
  const canSave = verified && !settings.saving;

  const sectionHeading = "typo-caption uppercase tracking-widest text-foreground";
  const inputClass =
    "w-full px-3 py-2 typo-body rounded-input bg-secondary/30 border border-primary/10 focus:border-indigo-400/40 focus-ring";

  return (
    <div className="space-y-6">
      {/* Host */}
      <div className="space-y-2">
        <h3 className={sectionHeading}>{t.plugins.langfuse.host_label}</h3>
        <label className="block space-y-1">
          <span className="typo-caption text-foreground flex items-center gap-1">
            <Globe className="w-3 h-3" />
            {t.plugins.langfuse.host_label}
          </span>
          <input
            type="url"
            value={host}
            onChange={(e) => {
              setHost(e.target.value);
              setVerifiedFingerprint(null);
            }}
            placeholder={t.plugins.langfuse.host_placeholder}
            className={inputClass}
            spellCheck={false}
          />
        </label>
      </div>

      {/* Keys */}
      <div className="space-y-2">
        <h3 className={sectionHeading}>{t.plugins.langfuse.public_key_label}</h3>
        <label className="block space-y-1">
          <span className="typo-caption text-foreground flex items-center gap-1">
            <KeyRound className="w-3 h-3" />
            {t.plugins.langfuse.public_key_label}
          </span>
          <input
            type="text"
            value={publicKey}
            onChange={(e) => {
              setPublicKey(e.target.value);
              setVerifiedFingerprint(null);
            }}
            placeholder={t.plugins.langfuse.public_key_placeholder}
            className={inputClass}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="block space-y-1">
          <span className="typo-caption text-foreground flex items-center gap-1">
            <KeyRound className="w-3 h-3" />
            {t.plugins.langfuse.secret_key_label}
          </span>
          <PasswordToggleField
            value={secretKey}
            onChange={(e) => {
              setSecretKey(e.target.value);
              setVerifiedFingerprint(null);
            }}
            placeholder={t.plugins.langfuse.secret_key_placeholder}
            inputClassName={inputClass}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <p className="typo-caption text-foreground">{t.plugins.langfuse.find_keys_hint}</p>
        <label className="block space-y-1 pt-2">
          <span className="typo-caption text-foreground">
            {t.plugins.langfuse.project_id_label}
          </span>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder={t.plugins.langfuse.project_id_placeholder}
            className={inputClass}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="typo-caption text-foreground">
            {t.plugins.langfuse.project_id_hint}
          </span>
        </label>
      </div>

      {/* Options */}
      <div className="space-y-3">
        <h3 className={sectionHeading}>{t.plugins.langfuse.options_section}</h3>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="typo-body text-foreground">{t.plugins.langfuse.enable_label}</div>
            <div className="typo-caption text-foreground">{t.plugins.langfuse.enable_desc}</div>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={redactContent}
            onChange={(e) => setRedactContent(e.target.checked)}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="typo-body text-foreground">{t.plugins.langfuse.redact_label}</div>
            <div className="typo-caption text-foreground">{t.plugins.langfuse.redact_desc}</div>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={pushLabScores}
            onChange={(e) => setPushLabScores(e.target.checked)}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="typo-body text-foreground">{t.plugins.langfuse.push_lab_scores_label}</div>
            <div className="typo-caption text-foreground/80">{t.plugins.langfuse.push_lab_scores_desc}</div>
          </div>
        </label>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-primary/10">
        <button
          type="button"
          onClick={() => void onTest()}
          disabled={!canTest || settings.testing}
          className="inline-flex items-center gap-2 px-4 py-2 typo-body rounded-modal border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {settings.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube2 className="w-4 h-4" />}
          {settings.testing ? t.plugins.langfuse.testing : t.plugins.langfuse.test_button}
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!canSave}
          className="inline-flex items-center gap-2 px-4 py-2 typo-body rounded-modal border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {settings.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {settings.saving ? t.plugins.langfuse.saving : t.plugins.langfuse.save_button}
        </button>
        {!verified && lastTest === null && canTest && (
          <span className="typo-caption text-foreground">{t.plugins.langfuse.test_required}</span>
        )}
      </div>

      {lastTest && <TestResultBanner result={lastTest} t={t} tx={tx} />}
    </div>
  );
}

function TestResultBanner({
  result,
  t,
  tx,
}: {
  result: LangfuseTestResult;
  t: ReturnType<typeof useTranslation>["t"];
  tx: ReturnType<typeof useTranslation>["tx"];
}) {
  const ok = result.ok;
  const Icon = ok ? CheckCircle2 : AlertCircle;
  const tone = ok
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : "border-red-500/30 bg-red-500/10 text-red-300";

  let body = result.message;
  if (ok && result.projectName) {
    body = tx(t.plugins.langfuse.connected_to_project, { name: result.projectName });
  }

  return (
    <div className={`flex items-start gap-2 p-3 typo-body rounded-card border ${tone}`}>
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>{body}</span>
    </div>
  );
}
