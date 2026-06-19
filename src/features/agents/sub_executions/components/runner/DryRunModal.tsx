import { useState, type ReactNode } from 'react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { CheckCircle2, AlertTriangle, X, FlaskConical, Copy, FileText, Wrench, Shield, Cpu } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { DryRunReport } from '@/lib/bindings/DryRunReport';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

interface DryRunModalProps {
  open: boolean;
  loading: boolean;
  report: DryRunReport | null;
  errorMessage: string | null;
  onClose: () => void;
}

export function DryRunModal({ open, loading, report, errorMessage, onClose }: DryRunModalProps) {
  const { t } = useTranslation();
  const d = t.agents.executions.dry_run;
  const [copied, setCopied] = useState(false);

  const handleCopyPrompt = async () => {
    if (!report?.prompt) return;
    try {
      await copyText(report.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      silentCatch('dry-run-copy-prompt')(e);
    }
  };

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="dry-run-modal-title"
      size="xl"
      portal
      panelClassName="bg-background border border-primary/15 rounded-modal shadow-elevation-4 overflow-hidden"
    >
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-primary/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-modal bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
              <FlaskConical className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 id="dry-run-modal-title" className="typo-heading text-foreground/90 truncate">
                {d.modal_title}
              </h3>
              <p className="typo-caption text-foreground truncate">
                {report?.persona_name ?? ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-card hover:bg-secondary/40 text-foreground hover:text-foreground transition-colors"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="dry-run-loading">
              <div className="w-8 h-8 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
              <p className="typo-body text-foreground">{d.running}</p>
            </div>
          )}

          {!loading && errorMessage && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-modal border border-red-500/30 bg-red-500/10">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="typo-heading text-red-300/90">{d.failed_title}</p>
                <p className="typo-body text-red-200/80 break-words">{errorMessage}</p>
              </div>
            </div>
          )}

          {!loading && report && (
            <>
              {/* Status banner */}
              <div
                className={`flex items-start gap-3 px-4 py-3 rounded-modal border ${
                  report.success
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-red-500/30 bg-red-500/10'
                }`}
                data-testid="dry-run-status"
              >
                {report.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 min-w-0">
                  <p className={`typo-heading ${report.success ? 'text-emerald-300/90' : 'text-red-300/90'}`}>
                    {report.success ? d.status_passed : d.status_failed}
                  </p>
                  <p className="typo-body text-foreground">
                    {report.success ? d.status_passed_hint : (report.error ?? d.status_failed_hint)}
                  </p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat icon={<Cpu className="w-3.5 h-3.5" />} label={d.stat_model} value={report.model ?? d.stat_default_model} />
                <Stat icon={<Wrench className="w-3.5 h-3.5" />} label={d.stat_tools} value={String(report.tools.length)} />
                <Stat icon={<Shield className="w-3.5 h-3.5" />} label={d.stat_credentials} value={String(report.resolved_credentials.length)} />
                <Stat icon={<FileText className="w-3.5 h-3.5" />} label={d.stat_prompt_chars} value={<Numeric value={report.prompt_chars} />} />
              </div>

              {/* Warnings */}
              {report.warnings.length > 0 && (
                <section className="space-y-2">
                  <h4 className="typo-heading text-foreground">{d.section_warnings}</h4>
                  <ul className="space-y-1.5">
                    {report.warnings.map((w, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 px-3 py-2 rounded-card border border-amber-500/25 bg-amber-500/8 text-amber-200/90 typo-body"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <span className="break-words">{w}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Credential failures */}
              {report.credential_failures.length > 0 && (
                <section className="space-y-2">
                  <h4 className="typo-heading text-foreground">{d.section_credential_failures}</h4>
                  <ul className="flex flex-wrap gap-1.5">
                    {report.credential_failures.map((c) => (
                      <li
                        key={c}
                        className="px-2 py-0.5 typo-caption rounded-card border border-red-500/30 bg-red-500/10 text-red-300"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Planned tool surface */}
              <section className="space-y-2">
                <h4 className="typo-heading text-foreground">{d.section_tool_surface}</h4>
                {report.tools.length === 0 ? (
                  <p className="typo-body text-foreground">{d.no_tools}</p>
                ) : (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {report.tools.map((tool) => (
                      <li
                        key={tool.name}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-card border border-primary/10 bg-secondary/30"
                      >
                        <Wrench className="w-3 h-3 text-foreground shrink-0" />
                        <span className="typo-code text-foreground/90 truncate">{tool.name}</span>
                        {tool.requires_credential_type && (
                          <span className="ml-auto typo-caption text-foreground">{tool.requires_credential_type}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Resolved credentials */}
              {report.resolved_credentials.length > 0 && (
                <section className="space-y-2">
                  <h4 className="typo-heading text-foreground">{d.section_resolved_credentials}</h4>
                  <ul className="flex flex-wrap gap-1.5">
                    {report.resolved_credentials.map((c) => (
                      <li
                        key={c}
                        className="px-2 py-0.5 typo-caption rounded-card border border-emerald-500/25 bg-emerald-500/8 text-emerald-300"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Assembled prompt */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="typo-heading text-foreground">{d.section_prompt}</h4>
                  <button
                    onClick={handleCopyPrompt}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-card typo-caption text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    {copied ? d.copied : d.copy_prompt}
                  </button>
                </div>
                <pre
                  data-testid="dry-run-prompt"
                  className="max-h-72 overflow-auto px-3 py-2.5 rounded-card border border-primary/10 bg-secondary/30 typo-code text-foreground/85 whitespace-pre-wrap break-words"
                >
                  {report.prompt}
                </pre>
              </section>

              {/* Footer meta */}
              {report.log_file_path && (
                <p className="typo-caption text-foreground break-all">
                  {d.log_file_path_label}: {report.log_file_path}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10 bg-secondary/20">
          <button
            onClick={onClose}
            className="px-4 py-1.5 typo-heading rounded-card text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-card border border-primary/10 bg-secondary/30">
      <div className="flex items-center gap-1.5 text-foreground typo-caption">
        {icon}
        <span>{label}</span>
      </div>
      <span className="typo-body text-foreground/90 truncate">{value}</span>
    </div>
  );
}
