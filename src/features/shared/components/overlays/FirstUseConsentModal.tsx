import { useState, useCallback } from 'react';
import {
  Shield,
  Brain,
  Database,
  Globe,
  Eye,
  Clipboard,
  FolderSearch,
  Terminal,
  Network,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import { setTelemetryEnabled } from '@/lib/telemetryPreference';

const CONSENT_KEY = '__personas_user_consent_accepted';
const CONSENT_VERSION = '2';

export function hasUserConsented(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === CONSENT_VERSION;
  } catch {
    return false;
  }
}

/** Return the stored consent version, or null if never consented. */
export function storedConsentVersion(): string | null {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

export function resetUserConsent(): void {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    // no-op
  }
}

function persistConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
  } catch {
    // Fallback: consent is session-only if localStorage unavailable
  }
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  tldr: string;
  items: string[];
  color: string;
  defaultOpen?: boolean;
  isNew?: boolean;
}

function ConsentSection({ icon, title, tldr, items, color, defaultOpen = false, isNew }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${open ? `border-${color}/25 bg-${color}/5` : 'border-primary/10 bg-secondary/20'}`}
      style={open ? { borderColor: `var(--color-${color}, rgba(100,100,100,0.25))` } : undefined}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/30 transition-colors"
      >
        <span className="shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="typo-heading text-foreground">
            {title}
            {isNew && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-blue-500/15 text-blue-400 border border-blue-500/25">
                New
              </span>
            )}
          </span>
          <p className="text-sm text-foreground mt-0.5">{tldr}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-foreground shrink-0" />}
      </button>
      {open && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <ul className="px-4 pb-3 space-y-1.5">
              {items.map((item, i) => (
                <li key={i} className="typo-body text-foreground flex items-start gap-2">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
    </div>
  );
}

interface FirstUseConsentModalProps {
  onAccept: () => void;
  /** When true, this is a re-consent for a version bump (show "what's new" hints). */
  isVersionBump?: boolean;
}

export function FirstUseConsentModal({ onAccept, isVersionBump }: FirstUseConsentModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [telemetryChecked, setTelemetryChecked] = useState(true);
  const noop = useCallback(() => {}, []);
  const { t } = useTranslation();
  const c = t.consent;

  const handleAccept = useCallback(() => {
    persistConsent();
    setTelemetryEnabled(telemetryChecked);
    onAccept();
  }, [onAccept, telemetryChecked]);

  return (
    <BaseModal
      isOpen
      onClose={noop}
      titleId="first-use-consent-title"
      containerClassName="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      maxWidthClass="max-w-3xl"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden max-h-[90vh]"
    >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-primary/10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 id="first-use-consent-title" className="typo-heading-lg text-foreground">{c.title}</h2>
              <p className="typo-body text-foreground">
                {isVersionBump
                  ? "We've updated our disclosures. Please review the changes before continuing."
                  : c.subtitle}
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <p className="typo-body text-foreground mb-4">
            {c.intro}
          </p>

          {/* Important warnings -- above accordion sections */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="typo-body text-foreground space-y-1.5">
              <p><span className="font-medium text-amber-400/90">{c.important}</span></p>
              <ul className="space-y-1 list-disc list-inside">
                <li>{c.notice_responsibility}</li>
                <li>{c.notice_accuracy}</li>
                <li>{c.notice_credentials}</li>
                <li>{c.notice_license}</li>
              </ul>
            </div>
          </div>

          <ConsentSection
            icon={<Brain className="w-4 h-4 text-violet-400" />}
            title={c.ai_title}
            tldr={c.ai_tldr}
            color="violet"
            defaultOpen
            items={[c.ai_detail_1, c.ai_detail_2, c.ai_detail_3, c.ai_detail_4]}
          />

          <ConsentSection
            icon={<Database className="w-4 h-4 text-emerald-400" />}
            title={c.storage_title}
            tldr={c.storage_tldr}
            color="emerald"
            items={[c.storage_detail_1, c.storage_detail_2, c.storage_detail_3, c.storage_detail_4]}
          />

          <ConsentSection
            icon={<Globe className="w-4 h-4 text-cyan-400" />}
            title={c.services_title}
            tldr={c.services_tldr}
            color="cyan"
            items={[c.services_detail_1, c.services_detail_2, c.services_detail_3, c.services_detail_4]}
          />

          <ConsentSection
            icon={<Eye className="w-4 h-4 text-amber-400" />}
            title={c.monitoring_title}
            tldr={c.monitoring_tldr}
            color="amber"
            items={[c.monitoring_clipboard, c.monitoring_file, c.monitoring_cron, c.monitoring_webhook]}
          />

          <ConsentSection
            icon={<Network className="w-4 h-4 text-indigo-400" />}
            title={c.p2p_title}
            tldr={c.p2p_tldr}
            color="indigo"
            isNew={isVersionBump}
            defaultOpen={!!isVersionBump}
            items={[c.p2p_detail_1, c.p2p_detail_2, c.p2p_detail_3, c.p2p_detail_4]}
          />

          <ConsentSection
            icon={<FolderSearch className="w-4 h-4 text-teal-400" />}
            title={c.foraging_title}
            tldr={c.foraging_tldr}
            color="teal"
            isNew={isVersionBump}
            defaultOpen={!!isVersionBump}
            items={[c.foraging_detail_1, c.foraging_detail_2, c.foraging_detail_3, c.foraging_detail_4]}
          />

          <ConsentSection
            icon={<Terminal className="w-4 h-4 text-orange-400" />}
            title={c.process_title}
            tldr={c.process_tldr}
            color="orange"
            items={[c.process_detail_1, c.process_detail_2, c.process_detail_3, c.process_detail_4]}
          />

          <ConsentSection
            icon={<Clipboard className="w-4 h-4 text-rose-400" />}
            title={c.telemetry_title}
            tldr={c.telemetry_tldr}
            color="rose"
            items={[c.telemetry_detail_1, c.telemetry_detail_2, c.telemetry_detail_3, c.telemetry_detail_4]}
          />

          <ConsentSection
            icon={<FolderSearch className="w-4 h-4 text-teal-400" />}
            title={c.deploy_title}
            tldr={c.deploy_tldr}
            color="teal"
            items={[c.deploy_detail_1, c.deploy_detail_2, c.deploy_detail_3]}
          />

          {/* General consent checkbox */}
          <label className="flex items-start gap-3 cursor-pointer py-3 select-none">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-primary/30 accent-blue-500"
            />
            <span className="typo-body text-foreground/90">
              {c.checkbox}
            </span>
          </label>

          {/* Telemetry opt-in checkbox */}
          <label className="flex items-start gap-3 cursor-pointer pb-2 select-none border-t border-primary/10 pt-3">
            <input
              type="checkbox"
              checked={telemetryChecked}
              onChange={e => setTelemetryChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-primary/30 accent-blue-500"
            />
            <span className="typo-body text-foreground">
              {c.checkbox_telemetry}
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-primary/10 flex items-center justify-between">
          <a
            href="https://github.com/anthropics/personas-desktop"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {c.source_link}
          </a>
          <button
            disabled={!acknowledged}
            onClick={handleAccept}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl typo-heading transition-all ${
              acknowledged
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-elevation-3 shadow-blue-600/20 cursor-pointer'
                : 'bg-secondary/40 text-foreground cursor-not-allowed'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {c.accept_button}
          </button>
        </div>
    </BaseModal>
  );
}
