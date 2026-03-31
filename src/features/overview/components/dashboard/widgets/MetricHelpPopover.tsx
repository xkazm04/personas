import { useState, useRef, useEffect, useCallback } from 'react';
import { HelpCircle, X } from 'lucide-react';

const STORAGE_KEY = 'dashboard-help-dismissed';

interface MetricHelpInfo {
  label: string;
  description: string;
  healthyRange: string;
  navigatesTo: string;
}

const METRIC_HELP: Record<string, MetricHelpInfo> = {
  messages: {
    label: 'Messages',
    description: 'Unread messages from your agents — status updates, alerts, and results they sent while running.',
    healthyRange: 'Ideally 0 unread. A growing count means agents need your attention.',
    navigatesTo: 'Opens the Messages tab to read and manage agent messages.',
  },
  reviews: {
    label: 'Reviews',
    description: 'Pending manual reviews — actions your agents flagged for human approval before proceeding.',
    healthyRange: 'Keep low. Items waiting too long can block agent workflows.',
    navigatesTo: 'Opens the Manual Review inbox to approve or reject pending items.',
  },
  alerts: {
    label: 'Alerts',
    description: 'Active alerts triggered by observability rules — failures, anomalies, or threshold breaches.',
    healthyRange: '0 is ideal. Any active alert may indicate an issue that needs investigation.',
    navigatesTo: 'Opens the Health dashboard to investigate and resolve alerts.',
  },
  runs: {
    label: 'Runs',
    description: 'Total agent executions across all personas — every time an agent ran a task.',
    healthyRange: 'Varies by setup. A sudden drop may mean a trigger or schedule is broken.',
    navigatesTo: 'Opens the Executions tab to see run history and details.',
  },
  success: {
    label: 'Success Rate',
    description: 'Percentage of agent runs that completed without errors.',
    healthyRange: 'Above 90% is good. Below 80% suggests agents need tuning or debugging.',
    navigatesTo: 'This is informational — click Runs to investigate failures.',
  },
  agents: {
    label: 'Active Agents',
    description: 'Number of personas currently enabled and capable of running automations.',
    healthyRange: 'Depends on your setup. If lower than expected, check agent settings.',
    navigatesTo: 'This is informational — visit the Agents page to manage personas.',
  },
};

function getDismissedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function persistDismissed(dismissed: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
}

export function MetricHelpPopover({ metricKey }: { metricKey: string }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissedSet());
  const ref = useRef<HTMLDivElement>(null);
  const info = METRIC_HELP[metricKey];

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  }, []);

  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, handleClickOutside]);

  if (!info || dismissed.has(metricKey)) return null;

  const handleDismiss = () => {
    setOpen(false);
    const next = new Set(dismissed);
    next.add(metricKey);
    setDismissed(next);
    persistDismissed(next);
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); } }}
        className="opacity-40 hover:opacity-80 transition-opacity focus:outline-none cursor-pointer"
        aria-label={`Help for ${info.label}`}
      >
        <HelpCircle className="w-3 h-3" />
      </span>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-64 rounded-xl border border-primary/10 bg-card p-3 shadow-xl text-left">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h4 className="typo-heading text-sm text-foreground">{info.label}</h4>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              aria-label="Dismiss help"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-2">{info.description}</p>
          <div className="text-xs space-y-1.5">
            <p className="text-emerald-400">
              <span className="font-medium">Healthy:</span> {info.healthyRange}
            </p>
            <p className="text-blue-400">
              <span className="font-medium">Click:</span> {info.navigatesTo}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
            className="mt-2.5 w-full text-xs text-center py-1 rounded-lg bg-primary/5 hover:bg-primary/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            Got it, don't show again
          </button>
        </div>
      )}
    </div>
  );
}
