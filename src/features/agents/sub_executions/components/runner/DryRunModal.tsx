import { useState, type ReactNode } from 'react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { CheckCircle2, AlertTriangle, X, FlaskConical, Copy, FileText, Wrench, Shield, Cpu } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { DryRunReport } from '@/lib/bindings/DryRunReport';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import Button from '@/features/shared/components/buttons/Button';

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
      panelClassName="bg-background border border-hair rounded-modal shadow-elevation-4 overflow-hidden"
    >
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-hair">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-modal bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
              <FlaskConical className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 id="dry-run-modal-title" className="typo-heading text-ink-1 truncate">
                {d.modal_title}
              </h3>
              <p className="typo-caption text-ink-2 truncate">
                {report?.persona_name ?? ''}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            variant="ghost"
            size="icon-sm"
            icon={<X className="w-4 h-4" />}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="dry-run-loading">
              <div className="w-8 h-8 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
              <p className="typo-body text-ink-1">{d.running}</p>
            </div>
          )}

          {!loading && errorMessage && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-modal border border-status-error/30 bg-status-error/10">
              <AlertTriangle className="w-4 h-4 text-status-error shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="typo-heading text-status-error">{d.failed_title}</p>
                <p className="typo-body text-status-error break-words">{errorMessage}</p>
              </div>
            </div>
          )}

          {!loading && report && (
            <>
              {/* Status banner */}
              <div
                className={`flex items-start gap-3 px-4 py-3 rounded-modal border ${
                  report.success
                    ? 'border-status-success/30 bg-status-success/10'
                    : 'border-status-error/30 bg-status-error/10'
                }`}
                data-testid="dry-run-status"
              >
                {report.success ? (
                  <CheckCircle2 className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-status-error shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 min-w-0">
                  <p className={`typo-heading ${report.success ? 'text-status-success' : 'text-status-error'}`}>
                    {report.success ? d.status_passed : d.status_failed}
                  </p>
                  <p className="typo-body text-ink-1">
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
                  <h4 className="typo-heading text-ink-1">{d.section_warnings}</h4>
                  <ul className="space-y-1.5">
                    {report.warnings.map((w, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 px-3 py-2 rounded-card border border-status-warning/25 bg-status-warning/8 text-status-warning typo-body"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-status-warning shrink-0 mt-0.5" />
                        <span className="break-words">{w}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Credential failures */}
              {report.credential_failures.length > 0 && (
                <section className="space-y-2">
                  <h4 className="typo-heading text-ink-1">{d.section_credential_failures}</h4>
                  <ul className="flex flex-wrap gap-1.5">
                    {report.credential_failures.map((c) => (
                      <li
                        key={c}
                        className="inline-flex items-center typo-caption text-status-error"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Planned tool surface */}
              <section className="space-y-2">
                <h4 className="typo-heading text-ink-1">{d.section_tool_surface}</h4>
                {report.tools.length === 0 ? (
                  <p className="typo-body text-ink-1">{d.no_tools}</p>
                ) : (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {report.tools.map((tool) => (
                      <li
                        key={tool.name}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-card border border-hair bg-surface-1"
                      >
                        <Wrench className="w-3 h-3 text-ink-1 shrink-0" />
                        <span className="typo-code text-ink-1 truncate">{tool.name}</span>
                        {tool.requires_credential_type && (
                          <span className="ml-auto typo-caption text-ink-2">{tool.requires_credential_type}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Resolved credentials */}
              {report.resolved_credentials.length > 0 && (
                <section className="space-y-2">
                  <h4 className="typo-heading text-ink-1">{d.section_resolved_credentials}</h4>
                  <ul className="flex flex-wrap gap-1.5">
                    {report.resolved_credentials.map((c) => (
                      <li
                        key={c}
                        className="inline-flex items-center typo-caption text-status-success"
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
                  <h4 className="typo-heading text-ink-1">{d.section_prompt}</h4>
                  <Button
                    type="button"
                    onClick={handleCopyPrompt}
                    variant="ghost"
                    size="xs"
                    icon={<Copy className="w-3 h-3" />}
                  >{copied ? d.copied : d.copy_prompt}</Button>
                </div>
                <pre
                  data-testid="dry-run-prompt"
                  className="max-h-72 overflow-auto px-3 py-2.5 rounded-card border border-hair bg-surface-1 typo-code text-ink-1 whitespace-pre-wrap break-words"
                >
                  {report.prompt}
                </pre>
              </section>

              {/* Footer meta */}
              {report.log_file_path && (
                <p className="typo-caption text-ink-2 break-all">
                  {d.log_file_path_label}: {report.log_file_path}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-hair bg-surface-1">
          <Button type="button" onClick={onClose} variant="ghost" size="sm">{t.common.close}</Button>
        </div>
      </div>
    </BaseModal>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-card border border-hair bg-surface-1">
      <div className="flex items-center gap-1.5 text-ink-2 typo-caption">
        {icon}
        <span>{label}</span>
      </div>
      <span className="typo-body text-ink-1 truncate">{value}</span>
    </div>
  );
}
