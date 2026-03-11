import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Brain,
  Database,
  Globe,
  Eye,
  Clipboard,
  FolderSearch,
  Terminal,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

const CONSENT_KEY = '__personas_user_consent_accepted';
const CONSENT_VERSION = '1';

export function hasUserConsented(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === CONSENT_VERSION;
  } catch {
    return false;
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
}

function ConsentSection({ icon, title, tldr, items, color, defaultOpen = false }: SectionProps) {
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
          <span className="text-sm font-medium text-foreground">{title}</span>
          <p className="text-xs text-muted-foreground/70 mt-0.5">{tldr}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ul className="px-4 pb-3 space-y-1.5">
              {items.map((item, i) => (
                <li key={i} className="text-sm text-muted-foreground/80 flex items-start gap-2">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface FirstUseConsentModalProps {
  onAccept: () => void;
}

export function FirstUseConsentModal({ onAccept }: FirstUseConsentModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  const handleAccept = useCallback(() => {
    persistConsent();
    onAccept();
  }, [onAccept]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-2xl max-h-[90vh] mx-4 bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-primary/10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Welcome to Personas Desktop</h2>
              <p className="text-sm text-muted-foreground/70">Please review how this application works before continuing</p>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <p className="text-sm text-muted-foreground/80 mb-4">
            Personas Desktop is a local-first AI agent orchestration tool. Before you start, please understand what it does and what data it accesses.
          </p>

          <ConsentSection
            icon={<Brain className="w-4 h-4 text-violet-400" />}
            title="AI Provider Communication"
            tldr="Your prompts are sent to your chosen AI service using your own API key."
            color="violet"
            defaultOpen
            items={[
              'Your persona prompts, tool definitions, and input data are sent to the selected AI provider (Anthropic Claude, OpenAI Codex, Google Gemini, or GitHub Copilot) for execution.',
              'Requests are made over HTTPS to provider APIs. Each provider has its own terms of service and data retention policies.',
              'You supply your own API keys; they are encrypted locally and never shared with us.',
              'Execution output (including token counts and cost) is stored locally in your database.',
            ]}
          />

          <ConsentSection
            icon={<Database className="w-4 h-4 text-emerald-400" />}
            title="Local Data Storage"
            tldr="Your passwords are encrypted and all your data stays on your computer."
            color="emerald"
            items={[
              'All data (personas, execution history, logs, memories) is stored in a local SQLite database on your machine.',
              'Credential values (API keys, tokens, passwords) are encrypted with AES-256-GCM before storage. The encryption key is held in your OS keyring.',
              'Execution logs are written as plaintext files to your app data directory.',
              'No data is sent to Personas servers unless you explicitly use the optional cloud deployment feature.',
            ]}
          />

          <ConsentSection
            icon={<Globe className="w-4 h-4 text-cyan-400" />}
            title="Third-Party Service Connections"
            tldr="Agents can connect to services like Slack or GitHub using credentials you provide."
            color="cyan"
            items={[
              'Personas can make authenticated API calls to 40+ services (Slack, GitHub, Linear, Discord, Jira, Notion, databases, etc.) using credentials you provide.',
              'These calls are made on your behalf using your credentials. You control which services each persona can access.',
              'An API proxy validates URLs against a blocklist (private IPs, localhost) to mitigate SSRF risks.',
              'All external communication uses HTTPS (TLS 1.2+).',
            ]}
          />

          <ConsentSection
            icon={<Eye className="w-4 h-4 text-amber-400" />}
            title="System Monitoring Capabilities"
            tldr="Agents can watch your clipboard, files, or schedule to trigger actions automatically."
            color="amber"
            items={[
              'Clipboard Monitor: When enabled for a persona, the app polls your system clipboard (~500ms interval) to detect text changes matching configured regex patterns. Clipboard content is hashed for change detection and is not stored unless it triggers an execution.',
              'File Watcher: When configured, monitors specified local directories for file creation or modification to trigger persona execution.',
              'Cron Scheduler: Runs personas on configured schedules (cron expressions). Active only while the app is running.',
              'Webhook Server: A local HTTP server (localhost:9420) listens for inbound webhooks when webhook triggers are configured.',
            ]}
          />

          <ConsentSection
            icon={<Terminal className="w-4 h-4 text-orange-400" />}
            title="Process Execution"
            tldr="The app runs AI tools and scripts on your machine to carry out agent tasks."
            color="orange"
            items={[
              'The app spawns AI provider CLI processes (e.g., claude, codex, gemini) as child processes on your machine.',
              'Credentials are passed to child processes as environment variables (not CLI arguments) and scrubbed after execution.',
              'Browser automation (Auto-Credential setup) may launch a Playwright-controlled browser session to help set up OAuth credentials. This requires your explicit consent each time.',
              'Automations can trigger external workflows (GitHub Actions, GitLab CI/CD, n8n, webhooks) based on execution output.',
            ]}
          />

          <ConsentSection
            icon={<Clipboard className="w-4 h-4 text-rose-400" />}
            title="Error Reporting & Telemetry"
            tldr="Anonymous crash reports may be sent to help fix bugs â€” no personal data included."
            color="rose"
            items={[
              'Crash reports may be sent to Sentry for error tracking. IP addresses, email addresses, and request bodies are stripped before transmission.',
              'Anonymous feature usage data (which sections and tabs you visit) is sent to Sentry to help prioritize development. No personal data, credential values, or execution content is included.',
              'No personal data, credential values, or execution content is included in any telemetry.',
              'The app checks for updates via GitHub Releases.',
            ]}
          />

          <ConsentSection
            icon={<FolderSearch className="w-4 h-4 text-teal-400" />}
            title="Deployment (Optional)"
            tldr="You can optionally run agents in the cloud â€” nothing is uploaded unless you choose to."
            color="teal"
            items={[
              'You may optionally deploy personas to a cloud orchestrator, GitHub Actions, or GitLab CI/CD. This sends persona configuration (not credentials) to the selected platform.',
              'Cloud deployment uses OAuth authentication with a deep-link callback (personas:// protocol).',
              'Deployed personas run on the target platform under that platform\'s terms and security model.',
            ]}
          />

          {/* Important warnings */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5 mt-4">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground/80 space-y-1.5">
              <p><span className="font-medium text-amber-400/90">Important:</span></p>
              <ul className="space-y-1 list-disc list-inside">
                <li>You are responsible for the content of your persona prompts and the actions they take on connected services.</li>
                <li>AI outputs may be inaccurate, biased, or harmful. Always review execution results before acting on them.</li>
                <li>Credentials you store grant the app access to your accounts on third-party services. Use scoped tokens with minimal permissions where possible.</li>
                <li>This software is provided under the MIT License, without warranty of any kind.</li>
              </ul>
            </div>
          </div>

          {/* Acknowledgment checkbox */}
          <label className="flex items-start gap-3 cursor-pointer py-3 select-none">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-primary/30 accent-blue-500"
            />
            <span className="text-sm text-foreground/90">
              I understand that this application sends data to AI providers, accesses system resources (clipboard, file system, network), and executes processes on my behalf. I accept responsibility for how I configure and use it.
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-primary/10 flex items-center justify-between">
          <a
            href="https://github.com/anthropics/personas-desktop"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View source & license
          </a>
          <button
            disabled={!acknowledged}
            onClick={handleAccept}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all ${
              acknowledged
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 cursor-pointer'
                : 'bg-secondary/40 text-muted-foreground/40 cursor-not-allowed'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            I Understand, Continue
          </button>
        </div>
      </motion.div>
    </div>
  );
}
